

export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

export function betaVariance(alpha: number, beta: number): number {
  const total = alpha + beta;
  return (alpha * beta) / (total * total * (total + 1));
}


function lnGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const n = x - 1;
  let s = c[0]!;
  for (let i = 1; i < g + 2; i++) s += c[i]! / (n + i);
  const t = n + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (n + 0.5) * Math.log(t) - t + Math.log(s);
}


export function betaRegularized(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (a <= 0 || b <= 0) return 0;

  const logBeta = lnGamma(a + b) - lnGamma(a) - lnGamma(b);
  const bt = Math.exp(logBeta + a * Math.log(x) + b * Math.log(1 - x));

  const betacf = (aa: number, bb: number, xx: number): number => {
    const MAXIT = 200;
    const EPS = 3e-12;
    const FPMIN = 1e-300;
    const qab = aa + bb;
    const qap = aa + 1;
    const qam = aa - 1;
    let c = 1;
    let d = 1 - (qab * xx) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa2 = (m * (bb - m) * xx) / ((qam + m2) * (aa + m2));
      d = 1 + aa2 * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa2 / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;
      aa2 = (-(aa + m) * (qab + m) * xx) / ((aa + m2) * (qap + m2));
      d = 1 + aa2 * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa2 / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  };

  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export interface BetaCI {
  lower: number;
  upper: number;
  marginOfError: number;
}


export function betaCIExact(alpha: number, beta: number, level = 0.95): BetaCI {
  const lo = (1 - level) / 2;
  const hi = 1 - lo;

  const inverse = (p: number): number => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let loX = 0;
    let hiX = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (loX + hiX) / 2;
      if (betaRegularized(mid, alpha, beta) < p) loX = mid;
      else hiX = mid;
    }
    return (loX + hiX) / 2;
  };

  const lower = inverse(lo);
  const upper = inverse(hi);
  return { lower, upper, marginOfError: (upper - lower) / 2 };
}


export function ucbTerm(samples: number, totalSamples: number): number {
  if (samples <= 0) return Infinity;
  const n = Math.max(totalSamples, 1);
  return Math.sqrt((2 * Math.log(n)) / (samples + 1));
}
