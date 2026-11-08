export function readFileSync(): never {
  throw new Error("Reading the filesystem is not available in the browser.");
}

const emptyFs = { readFileSync };
export default emptyFs;
