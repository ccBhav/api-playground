import { playground } from "./src/playground.ts";

try {
  await playground();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
