export function bisector<D>(compare: (d: D, b: number) => number) {
  return {
    left: (a: ReadonlyArray<D>, x: number, lo = 0, hi = a.length) => {
      while (lo < hi) {
        // tslint:disable-next-line: no-bitwise
        const mid = (lo + hi) >>> 1;
        if (compare(a[mid], x) < 0) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      return lo;
    },
    right: (a: ReadonlyArray<D>, x: number, lo = 0, hi = a.length) => {
      while (lo < hi) {
        // tslint:disable-next-line: no-bitwise
        const mid = (lo + hi) >>> 1;
        if (compare(a[mid], x) > 0) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      return lo;
    },
  };
}
