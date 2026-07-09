// Minimal end-to-end example: run this once to activate, run it again to
// see the second call resolve entirely from the offline cache.
//
//   node examples/quickstart.mjs
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { SublimeKeysClient } from "sublimekeys";

const PRODUCT_ID = "my-app"; // replace with your own product slug from the dashboard

const client = new SublimeKeysClient(PRODUCT_ID);
const rl = readline.createInterface({ input: stdin, output: stdout });
const licenseKey = (await rl.question("Enter your license key: ")).trim();
rl.close();

const activateResult = await client.activate(licenseKey);
if (!activateResult.valid) {
  console.log(`Activation failed: ${activateResult.message}`);
  process.exit(1);
}
console.log(`Activated. Machine id: ${client.getMachineId()}`);

// Simulates the app's next launch.
const verifyResult = await client.verify(licenseKey);
console.log(`Verify result: valid=${verifyResult.valid} source=${verifyResult.source}`);
