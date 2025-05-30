// import * as grpc from '@grpc/grpc-js';
// import * as loader from '@grpc/proto-loader';
// const protos = loader.loadSync('src/_shared/services.proto', { enums: String });
// const protolca = (grpc.loadPackageDefinition(protos) as any).protolca;

// const URL = '192.168.1.108:8080';

// function printContent() {
//   // print the IDs and names of the impact methods and product systems in the
//   // database

//   const data = new protolca.services.DataService(URL, grpc.credentials.createInsecure());

//   // For impact methods
//   data
//     .getImpactMethods({})
//     .on('data', (method: any) =>
//       console.log(`impact method: id = ${method.id}, name = ${method.name}`),
//     );

//   // For product systems
//   data
//     .getProductSystems({})
//     .on('data', (system: any) =>
//       console.log(`product system: id = ${system.id}, name = ${system.name}`),
//     );
// }

// function calculationExample() {
//   // calculate a product system result

//   const results = new protolca.services.ResultService(URL, grpc.credentials.createInsecure());

//   var setup = {
//     productSystem: { id: '66344e38-411a-4996-8062-e92dd3cd211c' },
//     impactMethod: { id: '9a597be4-ce40-4acd-9ace-ca8edebce13f' },
//   };

//   results.calculate(setup, (err: any, response: any) => {
//     if (err) {
//       console.log('calculation failed', err);
//       return;
//     }

//     const result = response.result;
//     const impacts = results.getImpacts(result);
//     impacts.on('data', (impact: any) => {
//       const s =
//         impact.impactCategory.name + ': ' + impact.value + ' ' + impact.impactCategory.refUnit;
//       console.log(s);
//     });

//     // you should always dispose the result when you do
//     // not need it anymore; otherwise you leak memory
//     impacts.on('end', () => {
//       results.dispose(result, (err: any) => {
//         if (err) {
//           console.log('failed to dispose result', err);
//           return;
//         }
//         console.log('disposed result');
//         // results.close()
//       });
//     });
//   });
// }

// function main() {
//   printContent();
//   // calculationExample()
// }
// main();
