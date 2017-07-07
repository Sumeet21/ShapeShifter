export function bisect<D>(a: ReadonlyArray<number>, x: number) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    // tslint:disable-next-line: no-bitwise
    const mid = (lo + hi) >>> 1;
    if (a[mid] < x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
