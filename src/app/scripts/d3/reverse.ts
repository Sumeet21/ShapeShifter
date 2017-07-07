export function reverse(array, n) {
  var t,
    j = array.length,
    i = j - n;
  while (i < --j) (t = array[i]), (array[i++] = array[j]), (array[j] = t);
}
