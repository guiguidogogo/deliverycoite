import { RafflePublicPage } from "../../components/raffle-public-page";

const RESERVED_PATHS = new Set(["admin", "api", "account", "mesa", "profile", "rifas"]);

export default async function ShortRaffleSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (RESERVED_PATHS.has(slug)) {
    return null;
  }

  return <RafflePublicPage slug={slug} />;
}
