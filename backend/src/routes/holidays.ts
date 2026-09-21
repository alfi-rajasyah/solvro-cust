import { Router } from "express";
import Holidays from "date-holidays";
import { z } from "zod";
import { requireAuth } from "../http/auth.js";
import { validate } from "../http/validate.js";

interface Holiday {
  date: string;
  name: string;
  type: string;
}

const cache = new Map<number, Holiday[]>();
const hd = new Holidays("ID");

function getHolidaysForYear(year: number): Holiday[] {
  const cached = cache.get(year);
  if (cached) return cached;
  const raw = hd.getHolidays(year) ?? [];
  const list: Holiday[] = raw
    .filter((h) => h.type === "public")
    .map((h) => ({
      date: h.date.slice(0, 10),
      name: h.name,
      type: h.type,
    }));
  cache.set(year, list);
  return list;
}

const querySchema = z.object({
  year: z.coerce
    .number()
    .int()
    .min(1970)
    .max(2100)
    .default(new Date().getFullYear()),
});

export const holidaysRouter = Router();

holidaysRouter.use(requireAuth);

holidaysRouter.get("/", validate("query", querySchema), (req, res) => {
  const { year } = req.query as unknown as z.infer<typeof querySchema>;
  res.json(getHolidaysForYear(year));
});
