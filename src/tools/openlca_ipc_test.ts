import * as o from 'olca-ipc';

// // async function main() {
// //   const client = o.IpcClient.on('http://192.168.1.108:8080');
// //   const flows = await client.getDescriptors(o.RefType.Flow);
// //   for (const flow of flows) {
// //     console.log(`${flow.id} :: ${flow.name} :: ${flow.category}`);
// //   }
// // }

// // async function main() {
// //   const client = o.IpcClient.on('http://192.168.1.108:8080');
// //   const process = await client.get(o.RefType.Process,'d7422217-03c8-44d8-abb3-681a47904eaf');
// //   // console.log(`${process.id} :: ${process.name} :: ${process.category}`);
// //   console.log(`  ${process?.toJson()}`);

// // }

async function main() {
  // we can use a client for the REST or IPC (JSON-RPC) protocol
  // both clients implement the same interface
  const protocol: 'REST' | 'IPC' = 'IPC';
  const client =
    protocol === 'IPC'
      ? o.IpcClient.on('http://localhost:8080')
      : o.RestClient.on('http://localhost:8080');

  // select a product system
  const systems = await client.getDescriptors(o.RefType.ProductSystem);
  if (systems.length === 0) {
    console.log('error: no product systems found');
    return;
  }

  console.log('可用的产品系统:');
  systems.forEach((sys, index) => {
    console.log(`${index}: ${sys.name} (${sys.id})`);
  });

  //   const system = systems[1];
  //   console.log(`calculate system: ${system.name}`);

  //   // select an impact assessment method, if available
  //   const methods = await client.getDescriptors(o.RefType.ImpactMethod);
  //   for (const method of methods) {
  //     console.log(`  ${method.id} :: ${method.name}`);
  //   }

  //   // const method = methods.length >= 0 ? methods[4] : null;
  //   // if (!method) {
  //   //   console.log('  no LCIA method available');
  //   // } else {
  //   //   console.log(`  using LCIA method: ${method.name}`);
  //   // }

  //   const method = await client.get(o.RefType.ImpactMethod, '2618fc94-ddc7-4ebb-8b73-2ac22f1d06c5');

  //   // calculate the system
  //   console.log('  ... calculating ...');
  //   const setup = o.CalculationSetup.of({
  //     target: system,
  //     impactMethod: method,
  //   });
  //   const result = await client.calculate(setup);
  //   const state = await result.untilReady();
  //   if (state.error) {
  //     throw new Error(`calculation failed: ${state.error}`);
  //   }
  //   console.log('  done');

  //   // query the result
  //   const impacts = await result.getTotalImpacts();
  //   console.log('LCIA Results:');
  //   for (const impact of impacts) {
  //     const name = impact.impactCategory?.name;
  //     const unit = impact.impactCategory?.refUnit;
  //     console.log(`  ${name}: ${impact.amount?.toExponential(2)} ${unit}`);
  //   }

  //   // finally, dispose the result
  //   result.dispose();
}

main();
