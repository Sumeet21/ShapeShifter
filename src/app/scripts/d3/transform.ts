export function transform(trans) {
  if (trans == null) return (x, y?) => x;
  var x0,
    y0,
    kx = trans.scale[0],
    ky = trans.scale[1],
    dx = trans.translate[0],
    dy = trans.translate[1];
  return function(input, i) {
    if (!i) x0 = y0 = 0;
    var j = 2,
      n = input.length,
      output = new Array(n);
    output[0] = (x0 += input[0]) * kx + dx;
    output[1] = (y0 += input[1]) * ky + dy;
    while (j < n) (output[j] = input[j]), ++j;
    return output;
  };
}
