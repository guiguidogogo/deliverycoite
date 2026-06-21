type Coordinate = { latitude: number; longitude: number };

export type RouteStop = {
  id: string;
  latitude: number | null;
  longitude: number | null;
};

function distanceSquared(origin: Coordinate, destination: Coordinate) {
  const latitude = destination.latitude - origin.latitude;
  const longitude = destination.longitude - origin.longitude;
  return latitude * latitude + longitude * longitude;
}

// Heuristica gratuita inicial. O contrato pode ser substituido por OSRM/Google API.
export function optimizeRoute(stops: RouteStop[], origin?: Coordinate | null) {
  const withoutCoordinates = stops.filter((stop) => stop.latitude === null || stop.longitude === null);
  const remaining = stops.filter(
    (stop): stop is RouteStop & Coordinate => stop.latitude !== null && stop.longitude !== null
  );
  const optimized: RouteStop[] = [];
  let current = origin ?? (remaining[0]
    ? { latitude: remaining[0].latitude, longitude: remaining[0].longitude }
    : null);

  while (remaining.length) {
    if (!current) {
      optimized.push(...remaining);
      break;
    }
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((stop, index) => {
      const distance = distanceSquared(current!, stop);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    optimized.push(next);
    current = { latitude: next.latitude, longitude: next.longitude };
  }

  return [...optimized, ...withoutCoordinates];
}
