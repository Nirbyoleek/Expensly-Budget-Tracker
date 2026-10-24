import type { Category } from "./types";
import { TAXONOMY_CATEGORIES } from "./taxonomy";

/** Mirrors the category rows seeded by supabase/migrations 0001 and 0002. Subcategories live in lib/taxonomy.ts. */
export const SYSTEM_CATEGORIES: Category[] = TAXONOMY_CATEGORIES;

export const catMap = (cats: Category[]) => Object.fromEntries(cats.map((c) => [c.id, c])) as Record<string, Category>;
