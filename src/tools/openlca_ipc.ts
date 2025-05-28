import * as o from 'olca-ipc';

async function main() {
  const client = o.IpcClient.on('http://192.168.1.108:8080');
  const flows = await client.getDescriptors(o.RefType.Flow);
  for (const flow of flows) {
    console.log(`${flow.id} :: ${flow.name} :: ${flow.category}`);
  }
}

main();
