import * as z from "zod";

const dateParam = z.iso.date();

/** True if a path/query param is a strict 'YYYY-MM-DD' calendar date. */
export const isValidDate = (value: string): boolean => dateParam.safeParse(value).success;
