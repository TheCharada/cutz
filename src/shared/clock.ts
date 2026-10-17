export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now() {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}

  now() {
    return new Date(this.instant.getTime());
  }
}
