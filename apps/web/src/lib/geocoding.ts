export type Coordinates = {
  latitude: number;
  longitude: number;
};

export async function findAddressCoordinates(
  address: string,
  number: string,
  district: string
): Promise<Coordinates> {
  const query = [address, number, district, "Conceicao do Coite", "Bahia", "Brasil"]
    .filter(Boolean)
    .join(", ");
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error("Nao foi possivel localizar o endereco");
  }

  const results = (await response.json()) as Array<{ lat: string; lon: string }>;
  if (!results.length) {
    throw new Error("Endereco nao encontrado. Confira rua, numero e bairro.");
  }

  return {
    latitude: Number(results[0].lat),
    longitude: Number(results[0].lon)
  };
}
