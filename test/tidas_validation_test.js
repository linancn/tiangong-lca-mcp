#!/usr/bin/env node

/**
 * Test script for Tidas Data Validation Service
 *
 * This script demonstrates how to call the tidas_validate_data MCP tool
 * with different entity types and data samples.
 */

// Sample test data for different entity types
const testCases = {
  // Test 1: Valid Contact data
  validContact: {
    entityType: 'contact',
    data: {
      contactDataSet: {
        '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
        '@xmlns': 'http://lca.jrc.it/ILCD/Contact',
        '@version': '1.1',
        contactInformation: {
          dataSetInformation: {
            'common:UUID': '12345678-1234-1234-1234-123456789abc',
            'common:name': [
              { '@xml:lang': 'en', '#text': 'Dr. Jane Smith' },
              { '@xml:lang': 'zh', '#text': '张博士' },
            ],
            'common:shortName': [{ '@xml:lang': 'en', '#text': 'J. Smith' }],
            'common:classificationInformation': {
              'common:classification': [
                {
                  '@name': 'ILCD',
                  'common:class': [
                    {
                      '@level': '0',
                      '#text': 'Contact persons',
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  },

  // Test 2: Invalid Contact data (missing required UUID)
  invalidContact: {
    entityType: 'contact',
    data: {
      contactDataSet: {
        contactInformation: {
          dataSetInformation: {
            'common:name': [{ '@xml:lang': 'en', '#text': 'Invalid Contact' }],
            // Missing required 'common:UUID' field
          },
        },
      },
    },
  },

  // Test 3: Valid Flow data
  validFlow: {
    entityType: 'flow',
    data: {
      flowDataSet: {
        '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
        '@xmlns': 'http://lca.jrc.it/ILCD/Flow',
        '@version': '1.1',
        flowInformation: {
          dataSetInformation: {
            'common:UUID': '87654321-4321-4321-4321-cba987654321',
            'common:name': [
              { '@xml:lang': 'en', '#text': 'Carbon dioxide' },
              { '@xml:lang': 'zh', '#text': '二氧化碳' },
            ],
            'common:classificationInformation': {
              'common:classification': [
                {
                  '@name': 'ILCD',
                  'common:class': [
                    {
                      '@level': '0',
                      '#text': 'Elementary flows',
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  },

  // Test 4: Valid Process data
  validProcess: {
    entityType: 'process',
    data: {
      processDataSet: {
        '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
        '@xmlns': 'http://lca.jrc.it/ILCD/Process',
        '@version': '1.1',
        processInformation: {
          dataSetInformation: {
            'common:UUID': '11111111-2222-3333-4444-555555555555',
            'common:name': [
              { '@xml:lang': 'en', '#text': 'Steel production' },
              { '@xml:lang': 'zh', '#text': '钢铁生产' },
            ],
          },
        },
      },
    },
  },

  // Test 5: Valid Source data
  validSource: {
    entityType: 'source',
    data: {
      sourceDataSet: {
        '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
        '@xmlns': 'http://lca.jrc.it/ILCD/Source',
        '@version': '1.1',
        sourceInformation: {
          dataSetInformation: {
            'common:UUID': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            'common:shortName': [{ '@xml:lang': 'en', '#text': 'LCA Database 2024' }],
          },
        },
      },
    },
  },

  // Test 6: Valid FlowProperty data
  validFlowProperty: {
    entityType: 'flowProperty',
    data: {
      flowPropertyDataSet: {
        '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
        '@xmlns': 'http://lca.jrc.it/ILCD/FlowProperty',
        '@version': '1.1',
        flowPropertiesInformation: {
          dataSetInformation: {
            'common:UUID': 'fffffff-aaaa-bbbb-cccc-dddddddddddd',
            'common:name': [{ '@xml:lang': 'en', '#text': 'Mass' }],
          },
        },
      },
    },
  },

  // Test 7: Valid UnitGroup data
  validUnitGroup: {
    entityType: 'unitGroup',
    data: {
      unitGroupDataSet: {
        '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
        '@xmlns': 'http://lca.jrc.it/ILCD/UnitGroup',
        '@version': '1.1',
        unitGroupInformation: {
          dataSetInformation: {
            'common:UUID': '11111111-aaaa-bbbb-cccc-dddddddddddd',
            'common:name': [{ '@xml:lang': 'en', '#text': 'Mass units' }],
          },
        },
      },
    },
  },

  // Test 8: Valid LCIAMethod data
  validLCIAMethod: {
    entityType: 'lciaMethod',
    data: {
      LCIAMethodDataSet: {
        '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
        '@xmlns': 'http://lca.jrc.it/ILCD/LCIAMethod',
        '@version': '1.1',
        LCIAMethodInformation: {
          dataSetInformation: {
            'common:UUID': '22222222-bbbb-cccc-dddd-eeeeeeeeeeee',
            'common:name': [{ '@xml:lang': 'en', '#text': 'IPCC GWP 100a' }],
          },
        },
      },
    },
  },

  // Test 9: Valid LifeCycleModel data
  validLifeCycleModel: {
    entityType: 'lifeCycleModel',
    data: {
      lifeCycleModelDataSet: {
        '@xmlns:common': 'http://lca.jrc.it/ILCD/Common',
        '@xmlns': 'http://lca.jrc.it/ILCD/LifeCycleModel',
        '@version': '1.1',
        lifeCycleModelInformation: {
          dataSetInformation: {
            'common:UUID': '33333333-cccc-dddd-eeee-ffffffffffff',
            'common:name': [{ '@xml:lang': 'en', '#text': 'Product Life Cycle Model' }],
          },
        },
      },
    },
  },
};

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Tidas Data Validation Service - Test Cases');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Available test cases:');
console.log('  1. validContact        - ✓ Valid contact data');
console.log('  2. invalidContact      - ✗ Invalid contact data (missing UUID)');
console.log('  3. validFlow           - ✓ Valid flow data');
console.log('  4. validProcess        - ✓ Valid process data');
console.log('  5. validSource         - ✓ Valid source data');
console.log('  6. validFlowProperty   - ✓ Valid flow property data');
console.log('  7. validUnitGroup      - ✓ Valid unit group data');
console.log('  8. validLCIAMethod     - ✓ Valid LCIA method data');
console.log('  9. validLifeCycleModel - ✓ Valid life cycle model data\n');

console.log('To test with MCP Inspector:');
console.log('  1. Start the server: npm run start:server-local');
console.log(
  '  2. Open MCP Inspector: DANGEROUSLY_OMIT_AUTH=true npx @modelcontextprotocol/inspector',
);
console.log('  3. Call tool "tidas_validate_data" with test data\n');

console.log('Example MCP call:');
console.log('─────────────────────────────────────────────────────────────\n');
console.log(
  JSON.stringify(
    {
      name: 'tidas_validate_data',
      arguments: testCases.validContact,
    },
    null,
    2,
  ),
);
console.log('\n─────────────────────────────────────────────────────────────');

console.log('\nSupported entity types:');
const entityTypes = [
  { type: 'contact', name: 'Contact', nameCN: '联系人', desc: '验证联系人信息数据' },
  { type: 'flow', name: 'Flow', nameCN: '物质流', desc: '验证物质流数据' },
  { type: 'process', name: 'Process', nameCN: '过程', desc: '验证过程数据' },
  { type: 'source', name: 'Source', nameCN: '来源', desc: '验证数据来源信息' },
  { type: 'flowProperty', name: 'FlowProperty', nameCN: '流属性', desc: '验证流属性数据' },
  { type: 'unitGroup', name: 'UnitGroup', nameCN: '单位组', desc: '验证单位组数据' },
  {
    type: 'lciaMethod',
    name: 'LCIAMethod',
    nameCN: '影响评估方法',
    desc: '验证生命周期影响评估方法数据',
  },
  {
    type: 'lifeCycleModel',
    name: 'LifeCycleModel',
    nameCN: '生命周期模型',
    desc: '验证生命周期模型数据',
  },
];

entityTypes.forEach((entity, index) => {
  console.log(`  ${index + 1}. ${entity.type.padEnd(17)} - ${entity.name} (${entity.nameCN})`);
  console.log(`     ${entity.desc}`);
});

console.log('\n═══════════════════════════════════════════════════════════════\n');

// Export test cases for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = testCases;
}
