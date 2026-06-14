import type { Prisma } from "@prisma/client";

type Coordinates = {
  latitude: number;
  longitude: number;
};

type DeliverySettings = {
  deliveryFee: Prisma.Decimal;
  storeLatitude: number | null;
  storeLongitude: number | null;
  deliveryFeeTiers: Array<{
    maxDistanceKm: number;
    fee: Prisma.Decimal;
  }>;
};

const EARTH_RADIUS_KM = 6371;

export function distanceInKm(origin: Coordinates, destination: Coordinates) {
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function calculateDeliveryFee(
  settings: DeliverySettings,
  destination?: Coordinates
) {
  const tiers = [...settings.deliveryFeeTiers].sort(
    (left, right) => left.maxDistanceKm - right.maxDistanceKm
  );

  if (
    !tiers.length ||
    settings.storeLatitude === null ||
    settings.storeLongitude === null
  ) {
    return {
      fee: Number(settings.deliveryFee),
      distanceKm: null,
      requiresLocation: false
    };
  }

  if (!destination) {
    return {
      fee: null,
      distanceKm: null,
      requiresLocation: true
    };
  }

  const distanceKm = distanceInKm(
    {
      latitude: settings.storeLatitude,
      longitude: settings.storeLongitude
    },
    destination
  );
  const tier = tiers.find((item) => distanceKm <= item.maxDistanceKm);

  return {
    fee: tier ? Number(tier.fee) : null,
    distanceKm,
    requiresLocation: false
  };
}
