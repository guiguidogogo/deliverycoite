export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type LocatedAddress = Coordinates & {
  address: string;
  number: string;
  district: string;
};

async function searchCoordinates(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) return null;

  const results = (await response.json()) as Array<{ lat: string; lon: string }>;
  if (!results.length) return null;

  return {
    latitude: Number(results[0].lat),
    longitude: Number(results[0].lon)
  };
}

export async function findAddressCoordinates(
  address: string,
  number: string,
  district: string
): Promise<Coordinates> {
  const base = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br";
  const attempts = [
    `${base}&street=${encodeURIComponent(`${number} ${address}`)}&city=${encodeURIComponent("Conceicao do Coite")}&state=Bahia`,
    `${base}&street=${encodeURIComponent(address)}&city=${encodeURIComponent("Conceicao do Coite")}&state=Bahia`,
    `${base}&q=${encodeURIComponent([address, district, "Conceicao do Coite", "Bahia"].filter(Boolean).join(", "))}`,
    `${base}&q=${encodeURIComponent([district, "Conceicao do Coite", "Bahia"].filter(Boolean).join(", "))}`
  ];

  for (const url of attempts) {
    const location = await searchCoordinates(url);
    if (location) return location;
  }

  throw new Error("Endereco nao encontrado. Confira rua e bairro.");
}

export async function findAddressFromCoordinates(
  latitude: number,
  longitude: number
): Promise<LocatedAddress> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=18&lat=${latitude}&lon=${longitude}`,
    { headers: { Accept: "application/json" } }
  );
  if (!response.ok) {
    throw new Error("Nao foi possivel identificar o endereco");
  }

  const data = await response.json();
  const address = data.address ?? {};
  return {
    latitude,
    longitude,
    address:
      address.road ||
      address.pedestrian ||
      address.residential ||
      address.footway ||
      "",
    number: address.house_number || "",
    district:
      address.suburb ||
      address.neighbourhood ||
      address.quarter ||
      address.city_district ||
      ""
  };
}
