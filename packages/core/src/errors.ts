export class GeositeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeositeParseError";
  }
}

export class GeositeResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeositeResolveError";
  }
}

export class EgernEmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgernEmitError";
  }
}
