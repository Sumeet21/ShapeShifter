import { bisect } from './bisect';

export function neighbors(objects) {
  var indexesByArc = {}, // arc index -> array of object indexes
    nghs = objects.map(function() {
      return [];
    });

  function line(arcs, i) {
    arcs.forEach(function(a) {
      if (a < 0) a = ~a;
      var o = indexesByArc[a];
      if (o) o.push(i);
      else indexesByArc[a] = [i];
    });
  }

  function polygon(arcs, i) {
    arcs.forEach(function(arc) {
      line(arc, i);
    });
  }

  function geometry(o, i) {
    if (o.type === 'GeometryCollection')
      o.geometries.forEach(function(o) {
        geometry(o, i);
      });
    else if (o.type in geometryType) geometryType[o.type](o.arcs, i);
  }

  var geometryType = {
    LineString: line,
    MultiLineString: polygon,
    Polygon: polygon,
    MultiPolygon: function(arcs, i) {
      arcs.forEach(function(arc) {
        polygon(arc, i);
      });
    },
  };

  objects.forEach(geometry);

  for (var i in indexesByArc) {
    if (!indexesByArc.hasOwnProperty(i)) {
      continue;
    }
    for (var indexes = indexesByArc[i], m = indexes.length, j = 0; j < m; ++j) {
      for (var k = j + 1; k < m; ++k) {
        var ij = indexes[j],
          ik = indexes[k],
          n;
        if ((n = nghs[ij])[(i = bisect(n, ik).toString())] !== ik) {
          n.splice(i, 0, ik);
        }
        if ((n = nghs[ik])[(i = bisect(n, ij).toString()).toString()] !== ij) {
          n.splice(i, 0, ij);
        }
      }
    }
  }

  return nghs;
}
