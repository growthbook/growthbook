export abstract class Statistic {
  readonly n: number;

  constructor(n: number) {
    this.n = n;
  }

  abstract get variance(): number;
  abstract get mean(): number;

  get stddev(): number {
    return this.variance <= 0 ? 0 : Math.sqrt(this.variance);
  }

  get unadjustedMean(): number {
    return this.mean;
  }

  get unadjustedVariance(): number {
    return this.variance;
  }

  get hasZeroVariance(): boolean {
    return this.variance <= 0.0;
  }
}

export class SampleMeanStatistic extends Statistic {
  readonly sum: number;
  readonly sumSquares: number;

  constructor(args: { n: number; sum: number; sumSquares: number }) {
    super(args.n);
    this.sum = args.sum;
    this.sumSquares = args.sumSquares;
  }

  get variance(): number {
    if (this.n <= 1) return 0;
    return (this.sumSquares - this.sum ** 2 / this.n) / (this.n - 1);
  }

  get mean(): number {
    if (this.n === 0) return 0;
    return this.sum / this.n;
  }

  add(other: ProportionStatistic | SampleMeanStatistic): SampleMeanStatistic {
    return new SampleMeanStatistic({
      n: this.n + other.n,
      sum: this.sum + other.sum,
      sumSquares: this.sumSquares + other.sumSquares,
    });
  }
}

export class ProportionStatistic extends Statistic {
  readonly sum: number;

  constructor(args: { n: number; sum: number }) {
    super(args.n);
    this.sum = args.sum;
  }

  get sumSquares(): number {
    return this.sum;
  }

  get variance(): number {
    return this.mean * (1 - this.mean);
  }

  get mean(): number {
    if (this.n === 0) return 0;
    return this.sum / this.n;
  }

  add(other: ProportionStatistic | SampleMeanStatistic): SampleMeanStatistic {
    return new SampleMeanStatistic({
      n: this.n + other.n,
      sum: this.sum + other.sum,
      sumSquares: this.sumSquares + other.sumSquares,
    });
  }
}
