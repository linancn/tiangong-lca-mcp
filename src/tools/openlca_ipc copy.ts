// import * as o from 'olca-ipc';

// async function main(systemProcess?: string, impactMethod?: string) {
//   if (!systemProcess) {
//     console.error('No systemProcess provided');
//     return;
//   }

//   const client = o.IpcClient.on('http://192.168.1.108:8080');

//   const system = await client.get(o.RefType.ProductSystem, systemProcess);
//   // select an impact assessment method, if available
//   const methods = await client.getDescriptors(o.RefType.ImpactMethod);
//   for (const method of methods) {
//     console.log(`  ${method.id} :: ${method.name}`);
//   }

//   if (!impactMethod) {
//     console.error('No impactMethod provided');
//     return;
//   }
//   const selectedMethod = await client.get(o.RefType.ImpactMethod, impactMethod);
//   if (!selectedMethod) {
//     console.error('Impact method not found');
//     return;
//   }

//   // calculate the system
//   console.log('  ... calculating ...');
//   const setup = o.CalculationSetup.of({
//     target: system,
//     impactMethod: selectedMethod,
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
// }

// main('9cee0f7c-ba47-40e9-8137-4ef6f3c3d41c', '2618fc94-ddc7-4ebb-8b73-2ac22f1d06c5');
