import dagre from '@dagrejs/dagre';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createLifeCycleModel } from '@tiangong-lca/tidas-sdk/core';
import { supabase_base_url, supabase_publishable_key } from '../_shared/config.js';
import type { SupabaseSessionLike } from '../_shared/supabase_session.js';
import { resolveSupabaseAccessToken } from '../_shared/supabase_session.js';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = Record<string, any>;

const MAX_VALIDATION_ERROR_LENGTH = 4_000;
const NODE_WIDTH = 350;
const NODE_MIN_HEIGHT = 100;
const PORT_START_Y = 65;
const PORT_STEP_Y = 20;
const PAIRED_INPUT_START_Y = 58;
const PAIRED_OUTPUT_START_Y = 78;
const PAIRED_PORT_STEP_Y = 40;
const MIN_NODE_SIZE = 1;
const DAGRE_RANKDIR: 'LR' = 'LR';
const DAGRE_NODESEP = 88;
const DAGRE_EDGESEP = 24;
const DAGRE_RANKSEP = 170;
const DAGRE_MARGIN_X = 36;
const DAGRE_MARGIN_Y = 36;
const PRIMARY_COLOR = '#5c246a';
const BACKGROUND_COLOR = '#ffffff';
const MUTED_TEXT_COLOR = 'rgba(0,0,0,0.45)';
const BODY_TEXT_COLOR = '#000';

type LifecycleModelPayload = {
  jsonOrdered: JsonRecord;
  providedJsonTg?: JsonRecord;
  sourceFormat: 'native' | 'platform_bundle' | 'raw_record' | 'direct_fields';
};

type ModelEdge = {
  srcInternalId: string;
  dstInternalId: string;
  flowUuid: string;
};

type PortSpec = {
  side: 'INPUT' | 'OUTPUT';
  flowUuid: string;
  flowVersion: string;
  textLang: Array<Record<string, string>>;
  displayText: string;
  quantitativeReference: boolean;
  allocations?: JsonValue;
};

type ProcessLookup = {
  processId: string;
  version: string;
  shortDescription: Array<Record<string, string>>;
  label: JsonRecord;
  shortSummary: Array<Record<string, string>>;
  referenceExchange?: JsonRecord;
  exchangeByDirectionAndFlow: Map<string, JsonRecord>;
};

type NodeLayoutSpec = {
  internalId: string;
  nodeId: string;
  processId: string;
  processVersion: string;
  label: JsonRecord;
  shortSummary: Array<Record<string, string>>;
  multiplicationFactor: string;
  inputPorts: PortSpec[];
  outputPorts: PortSpec[];
  width: number;
  height: number;
  isReferenceProcess: boolean;
};

type LifecycleModelValidationResult = {
  success: boolean;
  error?: unknown;
};

type LifecycleModelValidator = {
  validate: () => LifecycleModelValidationResult;
  validateEnhanced: () => LifecycleModelValidationResult;
};

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function toJsonRecord(value: unknown, message: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as JsonRecord;
}

function parsePayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    const serialized = JSON.stringify(error);
    if (!serialized) {
      return String(error);
    }

    return serialized.length > MAX_VALIDATION_ERROR_LENGTH
      ? `${serialized.slice(0, MAX_VALIDATION_ERROR_LENGTH)}...`
      : serialized;
  } catch {
    return String(error);
  }
}

function normalizeLifecycleModelPayload(rawPayload: unknown): LifecycleModelPayload {
  const parsed = parsePayload(rawPayload);
  const singlePayload = Array.isArray(parsed) ? parsed[0] : parsed;

  if (Array.isArray(parsed) && parsed.length !== 1) {
    throw new Error(
      'Lifecycle model file import currently supports exactly one lifecycle model object per request.',
    );
  }

  const payload = asRecord(singlePayload);
  if (payload.json_ordered) {
    return {
      jsonOrdered: toJsonRecord(payload.json_ordered, 'payload.json_ordered must be an object.'),
      providedJsonTg: payload.json_tg
        ? toJsonRecord(payload.json_tg, 'payload.json_tg must be an object.')
        : undefined,
      sourceFormat: 'raw_record',
    };
  }

  if (payload.jsonOrdered) {
    return {
      jsonOrdered: toJsonRecord(payload.jsonOrdered, 'payload.jsonOrdered must be an object.'),
      providedJsonTg: payload.jsonTg
        ? toJsonRecord(payload.jsonTg, 'payload.jsonTg must be an object.')
        : undefined,
      sourceFormat: 'direct_fields',
    };
  }

  if (payload.lifeCycleModelDataSet) {
    const { json_tg, ...jsonOrdered } = payload;
    return {
      jsonOrdered: toJsonRecord(
        jsonOrdered,
        'payload must contain a lifeCycleModelDataSet object.',
      ),
      providedJsonTg: json_tg
        ? toJsonRecord(json_tg, 'payload.json_tg must be an object.')
        : undefined,
      sourceFormat: json_tg ? 'platform_bundle' : 'native',
    };
  }

  throw new Error(
    'Unsupported lifecycle model payload. Provide { lifeCycleModelDataSet }, { lifeCycleModelDataSet, json_tg }, { json_ordered, json_tg }, or an array containing exactly one of those objects.',
  );
}

function getModelDataSet(jsonOrdered: JsonRecord): JsonRecord {
  const dataSet = jsonOrdered.lifeCycleModelDataSet;
  if (!dataSet || typeof dataSet !== 'object' || Array.isArray(dataSet)) {
    throw new Error('jsonOrdered.lifeCycleModelDataSet is required.');
  }
  return dataSet as JsonRecord;
}

function getModelUuid(jsonOrdered: JsonRecord): string {
  const dataSet = getModelDataSet(jsonOrdered);
  const uuid = asRecord(asRecord(asRecord(dataSet.lifeCycleModelInformation).dataSetInformation))[
    'common:UUID'
  ];
  if (typeof uuid !== 'string' || uuid.length === 0) {
    throw new Error(
      'lifeCycleModelInformation.dataSetInformation.common:UUID is required in the lifecycle model.',
    );
  }
  return uuid;
}

function getModelVersion(jsonOrdered: JsonRecord): string {
  const dataSet = getModelDataSet(jsonOrdered);
  const version = asRecord(asRecord(dataSet.administrativeInformation).publicationAndOwnership)[
    'common:dataSetVersion'
  ];
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(
      'administrativeInformation.publicationAndOwnership.common:dataSetVersion is required in the lifecycle model.',
    );
  }
  return version;
}

function createLifecycleModelValidator(jsonOrdered: JsonRecord): LifecycleModelValidator {
  return createLifeCycleModel(jsonOrdered, { mode: 'strict' }) as LifecycleModelValidator;
}

function validateLifecycleModelStrict(validator: LifecycleModelValidator): void {
  const validationResult = validator.validate();
  if (!validationResult.success) {
    const errorDetails = summarizeError(validationResult.error);
    throw new Error(`Lifecycle model validation failed: ${errorDetails}`);
  }
}

function langEntries(value: unknown): Array<Record<string, string>> {
  const entries = ensureArray(
    value as Record<string, string> | Array<Record<string, string>>,
  ).filter((item) => item && typeof item === 'object') as Array<Record<string, string>>;

  if (entries.length > 0) {
    return cloneJson(entries);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return [{ '@xml:lang': 'en', '#text': value.trim() }];
  }

  return [];
}

function preferredText(value: unknown): string {
  const entries = langEntries(value);
  const preferredOrder = ['zh', 'zh-cn', 'zh-hans', 'en'];
  for (const lang of preferredOrder) {
    const match = entries.find((item) => (item['@xml:lang'] || '').toLowerCase() === lang);
    if (match?.['#text']) {
      return match['#text'];
    }
  }
  return entries[0]?.['#text'] ?? '';
}

function buildSyntheticName(shortDescription: unknown): JsonRecord {
  return {
    baseName: langEntries(shortDescription),
    treatmentStandardsRoutes: [],
    mixAndLocationTypes: [],
    functionalUnitFlowProperties: [],
  };
}

function buildNameSummary(name: unknown): Array<Record<string, string>> {
  const nameRecord = asRecord(name);
  const partMap = new Map<string, string[]>();
  const keys = [
    'baseName',
    'treatmentStandardsRoutes',
    'mixAndLocationTypes',
    'functionalUnitFlowProperties',
  ];

  for (const key of keys) {
    for (const item of langEntries(nameRecord[key])) {
      const lang = (item['@xml:lang'] || 'en').toLowerCase();
      const text = item['#text'] || '';
      if (!text) {
        continue;
      }
      if (!partMap.has(lang)) {
        partMap.set(lang, []);
      }
      partMap.get(lang)!.push(text);
    }
  }

  return Array.from(partMap.entries())
    .map(([lang, parts]) => ({
      '@xml:lang': lang,
      '#text': parts.filter(Boolean).join('; '),
    }))
    .filter((item) => item['#text'].length > 0);
}

function extractInternalId(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  const candidate = asRecord(value)['@id'];
  return typeof candidate === 'string' ? candidate : '';
}

function processInstancesFromModel(jsonOrdered: JsonRecord): Array<JsonRecord> {
  const dataSet = getModelDataSet(jsonOrdered);
  return ensureArray(
    asRecord(asRecord(asRecord(asRecord(dataSet.lifeCycleModelInformation).technology).processes))
      .processInstance as JsonRecord | JsonRecord[] | undefined,
  ).map((item) => asRecord(item));
}

function processInstanceInternalId(instance: JsonRecord): string {
  return String(instance['@dataSetInternalID'] ?? '').trim();
}

function graphProcessInstancesFromModel(jsonOrdered: JsonRecord): Array<JsonRecord> {
  const processInstances = processInstancesFromModel(jsonOrdered);
  const missingInternalIdIndexes = processInstances.flatMap((instance, index) =>
    processInstanceInternalId(instance) ? [] : [index],
  );

  if (missingInternalIdIndexes.length > 0) {
    throw new Error(
      `Lifecycle model graph generation requires processInstance.@dataSetInternalID for every process. Missing values at indexes: ${missingInternalIdIndexes.join(', ')}.`,
    );
  }

  return processInstances;
}

function referenceProcessInternalIdFromModel(jsonOrdered: JsonRecord): string {
  const dataSet = getModelDataSet(jsonOrdered);
  const quantitativeReference = asRecord(
    asRecord(dataSet.lifeCycleModelInformation).quantitativeReference,
  );
  return extractInternalId(quantitativeReference.referenceToReferenceProcess);
}

function modelEdgesFromConnections(processInstances: Array<JsonRecord>): ModelEdge[] {
  const seen = new Set<string>();
  const edges: ModelEdge[] = [];

  for (const instance of processInstances) {
    const srcInternalId = processInstanceInternalId(instance);
    if (!srcInternalId) {
      continue;
    }

    const outputExchanges = ensureArray(
      asRecord(instance.connections).outputExchange as JsonRecord | JsonRecord[] | undefined,
    );
    for (const outputExchange of outputExchanges.map((item) => asRecord(item))) {
      const flowUuid = String(outputExchange['@flowUUID'] ?? '').trim();
      if (!flowUuid) {
        continue;
      }

      const downstreamProcesses = ensureArray(
        asRecord(outputExchange).downstreamProcess as JsonRecord | JsonRecord[] | undefined,
      ).map((item) => asRecord(item));

      for (const downstreamProcess of downstreamProcesses) {
        const dstInternalId = String(downstreamProcess['@id'] ?? '').trim();
        if (!dstInternalId) {
          continue;
        }

        const key = `${srcInternalId}|${dstInternalId}|${flowUuid}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        edges.push({ srcInternalId, dstInternalId, flowUuid });
      }
    }
  }

  return edges;
}

async function createSupabaseClient(
  bearerKey?: string | SupabaseSessionLike,
): Promise<{ supabase: SupabaseClient }> {
  const { session: normalizedSession, accessToken: bearerToken } =
    resolveSupabaseAccessToken(bearerKey);

  const supabase = createClient(supabase_base_url, supabase_publishable_key, {
    auth: {
      persistSession: false,
      autoRefreshToken: Boolean(normalizedSession?.refresh_token),
    },
    ...(bearerToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${bearerToken}`,
            },
          },
        }
      : {}),
  });

  if (normalizedSession?.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: normalizedSession.access_token,
      refresh_token: normalizedSession.refresh_token,
    });

    if (error) {
      console.warn('Failed to set Supabase session for lifecycle model file tools:', error.message);
    }
  }

  return { supabase };
}

function buildFallbackProcessLookup(
  processId: string,
  version: string,
  referenceToProcess: JsonRecord,
): ProcessLookup {
  const fallbackShortDescription = langEntries(referenceToProcess['common:shortDescription']);
  const fallbackLabel = buildSyntheticName(fallbackShortDescription);
  const fallbackSummary = buildNameSummary(fallbackLabel);

  return {
    processId,
    version,
    shortDescription: fallbackSummary,
    label: fallbackLabel,
    shortSummary: fallbackSummary,
    exchangeByDirectionAndFlow: new Map<string, JsonRecord>(),
  };
}

function processSelectionKey(processId: string, version: string): string {
  return `${processId}@@${version}`;
}

function extractProcessDataSet(row: Record<string, any> | undefined): JsonRecord {
  return asRecord(asRecord(row?.json_ordered).processDataSet);
}

async function loadReferencedProcessDataSets(
  supabase: SupabaseClient,
  processInstances: Array<JsonRecord>,
): Promise<Map<string, JsonRecord>> {
  const versionedIdsByVersion = new Map<string, Set<string>>();
  const unversionedIds = new Set<string>();

  for (const instance of processInstances) {
    const referenceToProcess = asRecord(instance.referenceToProcess);
    const processId = String(referenceToProcess['@refObjectId'] ?? '').trim();
    const version = String(referenceToProcess['@version'] ?? '').trim();
    if (!processId) {
      continue;
    }

    if (version) {
      if (!versionedIdsByVersion.has(version)) {
        versionedIdsByVersion.set(version, new Set<string>());
      }
      versionedIdsByVersion.get(version)!.add(processId);
      continue;
    }

    unversionedIds.add(processId);
  }

  const processDataSetBySelection = new Map<string, JsonRecord>();
  const batchFetches: Promise<void>[] = [];

  for (const [version, processIds] of versionedIdsByVersion.entries()) {
    const ids = Array.from(processIds);
    if (ids.length === 0) {
      continue;
    }

    batchFetches.push(
      (async () => {
        const { data, error } = await supabase
          .from('processes')
          .select('id, version, json_ordered')
          .eq('version', version)
          .in('id', ids);
        if (error) {
          throw new Error(
            `Failed to load referenced processes for version ${version}: ${error.message}`,
          );
        }

        for (const row of (data ?? []) as Array<Record<string, any>>) {
          const processId = String(row.id ?? '').trim();
          if (!processId) {
            continue;
          }
          processDataSetBySelection.set(
            processSelectionKey(processId, version),
            extractProcessDataSet(row),
          );
        }
      })(),
    );
  }

  if (unversionedIds.size > 0) {
    batchFetches.push(
      (async () => {
        const { data, error } = await supabase
          .from('processes')
          .select('id, version, json_ordered')
          .in('id', Array.from(unversionedIds))
          .order('version', { ascending: false });
        if (error) {
          throw new Error(`Failed to load referenced processes without version: ${error.message}`);
        }

        for (const row of (data ?? []) as Array<Record<string, any>>) {
          const processId = String(row.id ?? '').trim();
          if (!processId || processDataSetBySelection.has(processSelectionKey(processId, ''))) {
            continue;
          }
          processDataSetBySelection.set(
            processSelectionKey(processId, ''),
            extractProcessDataSet(row),
          );
        }
      })(),
    );
  }

  await Promise.all(batchFetches);
  return processDataSetBySelection;
}

async function fetchProcessLookups(
  supabase: SupabaseClient,
  processInstances: Array<JsonRecord>,
): Promise<Map<string, ProcessLookup>> {
  const lookups = new Map<string, ProcessLookup>();
  const processDataSetBySelection = await loadReferencedProcessDataSets(supabase, processInstances);

  const fetches = processInstances.map(async (instance) => {
    const referenceToProcess = asRecord(instance.referenceToProcess);
    const processId = String(referenceToProcess['@refObjectId'] ?? '').trim();
    const version = String(referenceToProcess['@version'] ?? '').trim();
    const internalId = processInstanceInternalId(instance);
    if (!internalId) {
      return;
    }

    if (!processId) {
      lookups.set(internalId, buildFallbackProcessLookup(processId, version, referenceToProcess));
      return;
    }

    const fallbackLookup = buildFallbackProcessLookup(processId, version, referenceToProcess);
    const processDataSet = processDataSetBySelection.get(processSelectionKey(processId, version));
    if (Object.keys(processDataSet ?? {}).length === 0) {
      lookups.set(internalId, fallbackLookup);
      return;
    }

    const info = asRecord(asRecord(asRecord(processDataSet).processInformation).dataSetInformation);
    const label =
      Object.keys(asRecord(info.name)).length > 0
        ? cloneJson(asRecord(info.name))
        : fallbackLookup.label;
    const shortSummary = buildNameSummary(label);
    const exchangeByDirectionAndFlow = new Map<string, JsonRecord>();
    let referenceExchange: JsonRecord | undefined;

    const refExchangeInternalId = String(
      asRecord(asRecord(asRecord(processDataSet).processInformation).quantitativeReference)
        .referenceToReferenceFlow ?? '',
    ).trim();

    for (const exchange of ensureArray(
      asRecord(processDataSet).exchanges?.exchange as JsonRecord | JsonRecord[] | undefined,
    ).map((item) => asRecord(item))) {
      const flowRef = asRecord(exchange.referenceToFlowDataSet);
      const flowId = String(flowRef['@refObjectId'] ?? '').trim();
      const direction = String(exchange.exchangeDirection ?? '').trim();
      if (flowId && direction) {
        exchangeByDirectionAndFlow.set(`${direction}:${flowId}`, exchange);
      }
      if (
        (!referenceExchange && exchange.quantitativeReference === true) ||
        (refExchangeInternalId &&
          String(exchange['@dataSetInternalID'] ?? '').trim() === refExchangeInternalId)
      ) {
        referenceExchange = exchange;
      }
    }

    lookups.set(internalId, {
      processId,
      version,
      shortDescription:
        shortSummary.length > 0
          ? shortSummary
          : langEntries(referenceToProcess['common:shortDescription']),
      label,
      shortSummary:
        shortSummary.length > 0
          ? shortSummary
          : langEntries(referenceToProcess['common:shortDescription']),
      referenceExchange,
      exchangeByDirectionAndFlow,
    });
  });

  await Promise.all(fetches);
  return lookups;
}

function flowPortFallback(flowUuid: string): Array<Record<string, string>> {
  return [{ '@xml:lang': 'en', '#text': flowUuid }];
}

function exchangeAmount(exchange?: JsonRecord): string {
  if (!exchange) {
    return '';
  }
  const candidate = exchange.meanAmount ?? exchange.resultingAmount ?? exchange.meanValue;
  return candidate === undefined || candidate === null ? '' : String(candidate);
}

function dagreLayout(
  nodes: NodeLayoutSpec[],
  edges: ModelEdge[],
): Map<string, { x: number; y: number }> {
  const dagreGraph = new dagre.graphlib.Graph({ multigraph: true });
  dagreGraph.setGraph({
    rankdir: DAGRE_RANKDIR,
    nodesep: DAGRE_NODESEP,
    edgesep: DAGRE_EDGESEP,
    ranksep: DAGRE_RANKSEP,
    marginx: DAGRE_MARGIN_X,
    marginy: DAGRE_MARGIN_Y,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
  });

  const nodeIdByInternalId = new Map(nodes.map((node) => [node.internalId, node.nodeId]));

  for (const node of nodes) {
    dagreGraph.setNode(node.nodeId, {
      width: Math.max(node.width, MIN_NODE_SIZE),
      height: Math.max(node.height, MIN_NODE_SIZE),
    });
  }

  for (const edge of edges) {
    const sourceNodeId = nodeIdByInternalId.get(edge.srcInternalId);
    const targetNodeId = nodeIdByInternalId.get(edge.dstInternalId);
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
      continue;
    }
    if (!dagreGraph.hasNode(sourceNodeId) || !dagreGraph.hasNode(targetNodeId)) {
      continue;
    }
    dagreGraph.setEdge(
      sourceNodeId,
      targetNodeId,
      {
        minlen: 1,
        weight: 2,
      },
      `${sourceNodeId}|${targetNodeId}|${edge.flowUuid}|${edge.srcInternalId}|${edge.dstInternalId}`,
    );
  }

  dagre.layout(dagreGraph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const layoutNode = dagreGraph.node(node.nodeId) as
      | {
          x: number;
          y: number;
          width: number;
          height: number;
        }
      | undefined;
    if (!layoutNode) {
      positions.set(node.internalId, { x: DAGRE_MARGIN_X, y: DAGRE_MARGIN_Y });
      continue;
    }
    positions.set(node.internalId, {
      x: layoutNode.x - layoutNode.width / 2,
      y: layoutNode.y - layoutNode.height / 2,
    });
  }

  return positions;
}

function buildPortItem(spec: PortSpec, y: number): JsonRecord {
  return {
    id: `${spec.side}:${spec.flowUuid}`,
    group: spec.side === 'INPUT' ? 'groupInput' : 'groupOutput',
    args: {
      x: spec.side === 'INPUT' ? 0 : '100%',
      y,
    },
    attrs: {
      text: {
        text: spec.displayText,
        title: spec.displayText,
        cursor: 'pointer',
        fill: spec.quantitativeReference ? PRIMARY_COLOR : MUTED_TEXT_COLOR,
        'font-weight': spec.quantitativeReference ? 'bold' : 'normal',
      },
    },
    data: {
      textLang: spec.textLang,
      flowId: spec.flowUuid,
      flowVersion: spec.flowVersion,
      quantitativeReference: spec.quantitativeReference,
      allocations: spec.allocations,
    },
    tools: [{ id: 'portTool' }],
  };
}

function buildPortSpec(
  side: 'INPUT' | 'OUTPUT',
  flowUuid: string,
  exchange?: JsonRecord,
  overrideQuantitativeReference = false,
): PortSpec {
  const flowRef = asRecord(exchange?.referenceToFlowDataSet);
  const textLang = langEntries(flowRef['common:shortDescription']).length
    ? langEntries(flowRef['common:shortDescription'])
    : flowPortFallback(flowUuid);
  return {
    side,
    flowUuid,
    flowVersion: String(flowRef['@version'] ?? '').trim(),
    textLang,
    displayText: preferredText(textLang) || flowUuid,
    quantitativeReference:
      overrideQuantitativeReference || exchange?.quantitativeReference === true,
    allocations: exchange?.allocations as JsonValue | undefined,
  };
}

function mergeJsonTg(
  generated: JsonRecord,
  provided: JsonRecord | undefined,
  preferProvidedJsonTg: boolean,
): { jsonTg: JsonRecord; source: 'generated' | 'provided' | 'merged' } {
  if (!provided || !preferProvidedJsonTg) {
    return { jsonTg: generated, source: 'generated' };
  }

  const providedXflow = asRecord(provided.xflow);
  const providedSubmodels = ensureArray(
    provided.submodels as JsonRecord | JsonRecord[] | undefined,
  );

  const jsonTg: JsonRecord = {
    ...cloneJson(generated),
    ...cloneJson(provided),
    xflow:
      Object.keys(providedXflow).length > 0
        ? cloneJson(providedXflow)
        : cloneJson(asRecord(generated.xflow)),
    submodels:
      providedSubmodels.length > 0
        ? cloneJson(providedSubmodels)
        : cloneJson(ensureArray(generated.submodels as JsonRecord | JsonRecord[] | undefined)),
  };

  return { jsonTg, source: 'merged' };
}

function generateJsonTg(
  jsonOrdered: JsonRecord,
  processInstances: Array<JsonRecord>,
  processLookups: Map<string, ProcessLookup>,
): JsonRecord {
  const referenceProcessInternalId = referenceProcessInternalIdFromModel(jsonOrdered);
  const fallbackReferenceProcessInstance = processInstances[processInstances.length - 1];
  const resolvedReferenceProcessInternalId =
    referenceProcessInternalId ||
    String(fallbackReferenceProcessInstance?.['@dataSetInternalID'] ?? '').trim();
  const edges = modelEdgesFromConnections(processInstances);

  const outgoingEdges = new Map<string, ModelEdge[]>();
  const incomingEdges = new Map<string, ModelEdge[]>();
  for (const edge of edges) {
    if (!outgoingEdges.has(edge.srcInternalId)) {
      outgoingEdges.set(edge.srcInternalId, []);
    }
    outgoingEdges.get(edge.srcInternalId)!.push(edge);
    if (!incomingEdges.has(edge.dstInternalId)) {
      incomingEdges.set(edge.dstInternalId, []);
    }
    incomingEdges.get(edge.dstInternalId)!.push(edge);
  }

  const nodeIdCounts = new Map<string, number>();
  const nodeSpecs = processInstances.map((instance) => {
    const internalId = processInstanceInternalId(instance);
    const multiplicationFactor = String(instance['@multiplicationFactor'] ?? '1');
    const referenceToProcess = asRecord(instance.referenceToProcess);
    const lookup = processLookups.get(internalId);
    const label =
      lookup?.label ?? buildSyntheticName(referenceToProcess['common:shortDescription']);
    const shortSummary =
      lookup?.shortSummary && lookup.shortSummary.length > 0
        ? lookup.shortSummary
        : buildNameSummary(label);
    const processId = lookup?.processId || String(referenceToProcess['@refObjectId'] ?? '').trim();
    const processVersion = lookup?.version || String(referenceToProcess['@version'] ?? '').trim();
    const baseNodeId = processId || internalId;
    const occurrence = (nodeIdCounts.get(baseNodeId) ?? 0) + 1;
    nodeIdCounts.set(baseNodeId, occurrence);
    const nodeId = occurrence === 1 ? baseNodeId : `${baseNodeId}::${internalId}`;

    const portMap = new Map<string, PortSpec>();
    const registerPort = (spec: PortSpec) => {
      const key = `${spec.side}:${spec.flowUuid}`;
      if (!portMap.has(key)) {
        portMap.set(key, spec);
      }
    };

    if (lookup?.referenceExchange) {
      const direction = String(lookup.referenceExchange.exchangeDirection ?? '').toUpperCase();
      const flowId = String(
        asRecord(lookup.referenceExchange.referenceToFlowDataSet)['@refObjectId'] ?? '',
      ).trim();
      if (flowId && (direction === 'INPUT' || direction === 'OUTPUT')) {
        registerPort(
          buildPortSpec(
            direction as 'INPUT' | 'OUTPUT',
            flowId,
            lookup.referenceExchange,
            internalId === resolvedReferenceProcessInternalId,
          ),
        );
      }
    }

    for (const edge of incomingEdges.get(internalId) ?? []) {
      registerPort(
        buildPortSpec(
          'INPUT',
          edge.flowUuid,
          lookup?.exchangeByDirectionAndFlow.get(`Input:${edge.flowUuid}`),
        ),
      );
    }

    for (const edge of outgoingEdges.get(internalId) ?? []) {
      registerPort(
        buildPortSpec(
          'OUTPUT',
          edge.flowUuid,
          lookup?.exchangeByDirectionAndFlow.get(`Output:${edge.flowUuid}`),
        ),
      );
    }

    const inputPorts = Array.from(portMap.values()).filter((item) => item.side === 'INPUT');
    const outputPorts = Array.from(portMap.values()).filter((item) => item.side === 'OUTPUT');
    const hasInputs = inputPorts.length > 0;
    const hasOutputs = outputPorts.length > 0;
    const bothSides = hasInputs && hasOutputs;
    const pairCount = Math.max(inputPorts.length, outputPorts.length);
    const height = bothSides
      ? Math.max(NODE_MIN_HEIGHT + 10, 110 + Math.max(pairCount - 1, 0) * PAIRED_PORT_STEP_Y)
      : Math.max(inputPorts.length, outputPorts.length, 2) * PORT_STEP_Y + 60;

    return {
      internalId,
      nodeId,
      processId: processId || nodeId,
      processVersion,
      label,
      shortSummary,
      multiplicationFactor,
      inputPorts,
      outputPorts,
      width: NODE_WIDTH,
      height: Math.max(NODE_MIN_HEIGHT, height),
      isReferenceProcess: internalId === resolvedReferenceProcessInternalId,
    };
  });
  const nodeSpecByInternalId = new Map(nodeSpecs.map((node) => [node.internalId, node]));
  const positions = dagreLayout(nodeSpecs, edges);
  const nodes = nodeSpecs.map((nodeSpec) => {
    const bothSides = nodeSpec.inputPorts.length > 0 && nodeSpec.outputPorts.length > 0;
    const position = positions.get(nodeSpec.internalId) ?? { x: DAGRE_MARGIN_X, y: DAGRE_MARGIN_Y };
    const labelText = preferredText(nodeSpec.shortSummary);
    const portY = (side: 'INPUT' | 'OUTPUT', index: number) => {
      if (bothSides) {
        return side === 'INPUT'
          ? PAIRED_INPUT_START_Y + index * PAIRED_PORT_STEP_Y
          : PAIRED_OUTPUT_START_Y + index * PAIRED_PORT_STEP_Y;
      }
      return PORT_START_Y + index * PORT_STEP_Y;
    };

    return {
      id: nodeSpec.nodeId,
      shape: 'rect',
      position,
      size: {
        width: nodeSpec.width,
        height: nodeSpec.height,
      },
      attrs: {
        body: {
          stroke: PRIMARY_COLOR,
          strokeWidth: 1,
          fill: BACKGROUND_COLOR,
          rx: 6,
          ry: 6,
        },
        label: {
          fill: BODY_TEXT_COLOR,
          refX: 0.5,
          refY: 8,
          text: labelText,
          textAnchor: 'middle',
          textVerticalAnchor: 'top',
        },
        text: {
          fill: BODY_TEXT_COLOR,
          text: labelText,
        },
      },
      isMyProcess: true,
      data: {
        id: nodeSpec.processId,
        version: nodeSpec.processVersion,
        index: nodeSpec.internalId,
        label: nodeSpec.label,
        shortDescription: nodeSpec.shortSummary,
        quantitativeReference: nodeSpec.isReferenceProcess ? '1' : '0',
        targetAmount: nodeSpec.isReferenceProcess ? '1' : '',
        multiplicationFactor: nodeSpec.multiplicationFactor,
      },
      ports: {
        groups: {
          groupInput: {
            position: { name: 'absolute' },
            label: { position: { name: 'right' } },
            attrs: {
              circle: {
                stroke: PRIMARY_COLOR,
                fill: BACKGROUND_COLOR,
                strokeWidth: 1,
                r: 4,
                magnet: true,
              },
              text: { fill: MUTED_TEXT_COLOR, fontSize: 14 },
            },
          },
          groupOutput: {
            position: { name: 'absolute' },
            label: { position: { name: 'left' } },
            attrs: {
              circle: {
                stroke: PRIMARY_COLOR,
                fill: BACKGROUND_COLOR,
                strokeWidth: 1,
                r: 4,
                magnet: true,
              },
              text: { fill: MUTED_TEXT_COLOR, fontSize: 14 },
            },
          },
        },
        items: [
          ...nodeSpec.inputPorts.map((item, index) => buildPortItem(item, portY('INPUT', index))),
          ...nodeSpec.outputPorts.map((item, index) => buildPortItem(item, portY('OUTPUT', index))),
        ],
      },
      tools: { name: null, items: [] },
      visible: true,
      zIndex: 1,
    };
  });

  const instanceMap = new Map(
    processInstances.map((instance) => [processInstanceInternalId(instance), asRecord(instance)]),
  );

  const xflowEdges = edges.map((edge) => {
    const sourceNode = nodeSpecByInternalId.get(edge.srcInternalId);
    const targetNode = nodeSpecByInternalId.get(edge.dstInternalId);
    const sourceLookup = processLookups.get(edge.srcInternalId);
    const targetLookup = processLookups.get(edge.dstInternalId);
    const targetExchange = targetLookup?.exchangeByDirectionAndFlow.get(`Input:${edge.flowUuid}`);
    const sourceProcessId =
      sourceNode?.processId ??
      sourceLookup?.processId ??
      String(
        asRecord(instanceMap.get(edge.srcInternalId)?.referenceToProcess)['@refObjectId'] ?? '',
      );
    const targetProcessId =
      targetNode?.processId ??
      targetLookup?.processId ??
      String(
        asRecord(instanceMap.get(edge.dstInternalId)?.referenceToProcess)['@refObjectId'] ?? '',
      );
    return {
      id: crypto.randomUUID(),
      shape: 'edge',
      source: { cell: sourceNode?.nodeId ?? edge.srcInternalId, port: `OUTPUT:${edge.flowUuid}` },
      target: { cell: targetNode?.nodeId ?? edge.dstInternalId, port: `INPUT:${edge.flowUuid}` },
      labels: [],
      attrs: {
        line: {
          stroke: PRIMARY_COLOR,
        },
      },
      data: {
        connection: {
          outputExchange: {
            '@flowUUID': edge.flowUuid,
            downstreamProcess: {
              '@id': edge.dstInternalId,
              '@flowUUID': edge.flowUuid,
            },
          },
          isBalanced: true,
          unbalancedAmount: 0,
          exchangeAmount: exchangeAmount(targetExchange),
        },
        node: {
          sourceNodeID: sourceNode?.nodeId ?? edge.srcInternalId,
          sourceProcessId,
          sourceProcessVersion:
            sourceNode?.processVersion ??
            processLookups.get(edge.srcInternalId)?.version ??
            String(
              asRecord(instanceMap.get(edge.srcInternalId)?.referenceToProcess)['@version'] ?? '',
            ),
          targetNodeID: targetNode?.nodeId ?? edge.dstInternalId,
          targetProcessId,
          targetProcessVersion:
            targetNode?.processVersion ??
            processLookups.get(edge.dstInternalId)?.version ??
            String(
              asRecord(instanceMap.get(edge.dstInternalId)?.referenceToProcess)['@version'] ?? '',
            ),
        },
      },
      zIndex: 4,
    };
  });

  const modelDataSet = getModelDataSet(jsonOrdered);
  const dataSetInformation = asRecord(
    asRecord(modelDataSet.lifeCycleModelInformation).dataSetInformation,
  );
  const referenceToResultingProcess = asRecord(dataSetInformation.referenceToResultingProcess);
  const referenceProcessInstance =
    processInstances.find(
      (instance) =>
        String(instance['@dataSetInternalID'] ?? '').trim() === resolvedReferenceProcessInternalId,
    ) ?? fallbackReferenceProcessInstance;
  const referenceProcessRef = asRecord(referenceProcessInstance?.referenceToProcess);
  const referenceProcessLookup = processLookups.get(resolvedReferenceProcessInternalId);
  const referenceNodeSpec = nodeSpecByInternalId.get(resolvedReferenceProcessInternalId);
  const referenceExchange = referenceProcessLookup?.referenceExchange;
  const fallbackEdge = (outgoingEdges.get(resolvedReferenceProcessInternalId) ?? [])[0];
  const finalId: JsonRecord = {
    nodeId:
      referenceNodeSpec?.nodeId ||
      String(referenceProcessRef['@refObjectId'] ?? '') ||
      resolvedReferenceProcessInternalId,
    processId: referenceNodeSpec?.processId || String(referenceProcessRef['@refObjectId'] ?? ''),
  };

  if (referenceExchange) {
    finalId.allocatedExchangeFlowId = String(
      asRecord(referenceExchange.referenceToFlowDataSet)['@refObjectId'] ?? '',
    );
    finalId.allocatedExchangeDirection = String(referenceExchange.exchangeDirection ?? '');
  } else if (fallbackEdge) {
    finalId.referenceToFlowDataSet = {
      '@refObjectId': fallbackEdge.flowUuid,
      '@exchangeDirection': 'Output',
    };
  }

  const submodels = [
    {
      id: String(referenceToResultingProcess['@refObjectId'] ?? getModelUuid(jsonOrdered)),
      type: 'primary',
      finalId,
    },
  ];

  return {
    xflow: {
      nodes,
      edges: xflowEdges,
    },
    submodels,
  };
}

function deriveRuleVerification(validator: LifecycleModelValidator): {
  ruleVerification: boolean;
  issueCount: number;
  filteredIssues: unknown[];
} {
  const enhanced = validator.validateEnhanced();
  if (enhanced.success) {
    return { ruleVerification: true, issueCount: 0, filteredIssues: [] };
  }

  const issues = ensureArray(asRecord(enhanced.error).issues as unknown[] | undefined);
  const filteredIssues = issues.filter((issue) => {
    const path = ensureArray(asRecord(issue).path as string[] | undefined).map((part) =>
      String(part),
    );
    return !path.includes('validation') && !path.includes('compliance');
  });

  return {
    ruleVerification: filteredIssues.length === 0,
    issueCount: filteredIssues.length,
    filteredIssues,
  };
}

export type PreparedLifecycleModelFile = {
  sourceFormat: LifecycleModelPayload['sourceFormat'];
  lifecycleModelId: string;
  lifecycleModelVersion: string;
  jsonTgSource: 'generated' | 'provided' | 'merged';
  processCount: number;
  nodeCount: number;
  edgeCount: number;
  submodelCount: number;
  ruleVerification: boolean;
  validationIssueCount: number;
  validationIssues: unknown[];
  jsonOrdered: JsonRecord;
  jsonTg: JsonRecord;
};

type PrepareLifecycleModelFileInput = {
  payload: unknown;
  id?: string;
  version?: string;
  preferProvidedJsonTg?: boolean;
};

export async function prepareLifecycleModelFile(
  input: PrepareLifecycleModelFileInput,
  bearerKey?: string | SupabaseSessionLike,
): Promise<PreparedLifecycleModelFile> {
  const preferProvidedJsonTg = input.preferProvidedJsonTg ?? false;
  const normalized = normalizeLifecycleModelPayload(input.payload);
  const jsonOrdered = normalized.jsonOrdered;
  const processInstances = graphProcessInstancesFromModel(jsonOrdered);
  const modelId = input.id ?? getModelUuid(jsonOrdered);
  const modelVersion = input.version ?? getModelVersion(jsonOrdered);
  const validator = createLifecycleModelValidator(jsonOrdered);
  validateLifecycleModelStrict(validator);
  const { supabase } = await createSupabaseClient(bearerKey);
  const processLookups = await fetchProcessLookups(supabase, processInstances);
  const generatedJsonTg = generateJsonTg(jsonOrdered, processInstances, processLookups);
  const merged = mergeJsonTg(generatedJsonTg, normalized.providedJsonTg, preferProvidedJsonTg);
  const validation = deriveRuleVerification(validator);

  return {
    sourceFormat: normalized.sourceFormat,
    lifecycleModelId: modelId,
    lifecycleModelVersion: modelVersion,
    jsonTgSource: merged.source,
    processCount: processInstances.length,
    nodeCount: ensureArray(asRecord(merged.jsonTg.xflow).nodes as JsonValue[] | undefined).length,
    edgeCount: ensureArray(asRecord(merged.jsonTg.xflow).edges as JsonValue[] | undefined).length,
    submodelCount: ensureArray(merged.jsonTg.submodels as JsonValue[] | undefined).length,
    ruleVerification: validation.ruleVerification,
    validationIssueCount: validation.issueCount,
    validationIssues: validation.filteredIssues,
    jsonOrdered,
    jsonTg: merged.jsonTg,
  };
}
