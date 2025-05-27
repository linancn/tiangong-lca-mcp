import * as o from "https://raw.githubusercontent.com/GreenDelta/olca-ipc.ts/main/mod.ts";

async function main() {
  const client = o.IpcClient.on(8080);
  const flows = await client.getDescriptors(o.RefType.Flow);
  for (const flow of flows) {
    console.log(`${flow.id} :: ${flow.name} :: ${flow.category}`);
  }
}

main();