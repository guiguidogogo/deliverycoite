export function chooseDriverCompany<
  T extends { driver: { company: { subdomain: string } } }
>(
  matches: T[],
  requestedSubdomain?: string
) {
  if (!requestedSubdomain) return matches;
  const normalized = requestedSubdomain.trim().toLowerCase();
  const exactMatches = matches.filter(
    ({ driver }) => driver.company.subdomain.toLowerCase() === normalized
  );
  return exactMatches.length ? exactMatches : matches;
}
