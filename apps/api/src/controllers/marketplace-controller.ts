import type { Request, Response } from "express";
import { getCompanyOpenStatus } from "../services/business-hours.js";
import { prisma } from "../utils/prisma.js";
import { env } from "../utils/env.js";

export async function listMarketplaceCompanies(req: Request, res: Response) {
  const search = req.query.search?.toString().trim();
  const category = req.query.category?.toString().trim();
  const city = req.query.city?.toString().trim();

  const companies = await prisma.company.findMany({
    where: {
      active: true,
      marketplaceVisible: true,
      ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
      ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
      ...(search ? {
        OR: [
          { tradeName: { contains: search, mode: "insensitive" } },
          { companyName: { contains: search, mode: "insensitive" } },
          { category: { contains: search, mode: "insensitive" } },
          { city: { contains: search, mode: "insensitive" } }
        ]
      } : {})
    },
    select: {
      id: true,
      tradeName: true,
      subdomain: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      businessType: true,
      category: true,
      city: true,
      isOpen: true,
      deliveryFee: true,
      deliveryTimeMin: true,
      rating: true,
      featured: true,
      settings: {
        select: {
          ordersPaused: true,
          openTime: true,
          closeTime: true,
          promoBannerImageUrl: true,
          promoBannerTitle: true
        },
        take: 1
      },
      products: {
        where: {
          active: true,
          available: true,
          promoPrice: { not: null }
        },
        select: { id: true, name: true, promoPrice: true, imageUrl: true },
        take: 3
      },
      _count: {
        select: {
          orders: { where: { status: { not: "CANCELED" } } }
        }
      }
    },
    orderBy: [
      { featured: "desc" },
      { rating: "desc" },
      { tradeName: "asc" }
    ]
  });

  const items = await Promise.all(companies.map(async (company) => {
    const settings = company.settings[0] ?? null;
    const openStatus = await getCompanyOpenStatus(company.id);
    return {
      id: company.id,
      name: company.tradeName,
      slug: company.subdomain,
      logo: company.logoUrl,
      primaryColor: company.primaryColor,
      secondaryColor: company.secondaryColor,
      category: company.category,
      businessType: company.businessType,
      city: company.city,
      isOpen: openStatus.isOpen,
      openStatus,
      openStatusMessage: openStatus.message,
      deliveryFee: Number(company.deliveryFee),
      deliveryTime: company.deliveryTimeMin,
      rating: Number(company.rating),
      featured: company.featured,
      orderCount: company._count.orders,
      promotionCount: company.products.length,
      promotions: company.products.map((product) => ({
        ...product,
        promoPrice: Number(product.promoPrice)
      })),
      promoBannerImageUrl: settings?.promoBannerImageUrl ?? null,
      promoBannerTitle: settings?.promoBannerTitle ?? null,
      publicUrl: `https://${company.subdomain}.${env.rootDomain}`
    };
  }));

  return res.json(items);
}

export async function marketplaceSummary(_req: Request, res: Response) {
  const [companies, cities, categories] = await Promise.all([
    prisma.company.count({ where: { active: true, marketplaceVisible: true } }),
    prisma.company.findMany({
      where: { active: true, marketplaceVisible: true },
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" }
    }),
    prisma.company.groupBy({
      by: ["category"],
      where: { active: true, marketplaceVisible: true },
      _count: { _all: true },
      orderBy: { _count: { category: "desc" } }
    })
  ]);

  return res.json({
    companies,
    cities: cities.map((item) => item.city),
    categories: categories.map((item) => ({
      name: item.category,
      count: item._count._all
    }))
  });
}
