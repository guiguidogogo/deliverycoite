import { RafflePublicPage } from "../../../components/raffle-public-page";

export default async function RaffleSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <RafflePublicPage slug={slug} />;
}
