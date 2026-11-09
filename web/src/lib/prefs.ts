// Small remembered choices (localStorage). Every access is guarded: storage can be
// blocked (private browsing, TV browsers), and then the choice just isn't remembered.

const NAME_KEY = "argus.viewerName";
const PRIVATE_KEY = "argus.privateRoom";

export function readName(): string {
  return read(NAME_KEY) ?? "";
}

export function saveName(name: string): void {
  write(NAME_KEY, name);
}

export function readPrivate(): boolean {
  return read(PRIVATE_KEY) === "1";
}

export function savePrivate(on: boolean): void {
  write(PRIVATE_KEY, on ? "1" : "0");
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked; not remembered.
  }
}
