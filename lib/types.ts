export type Box = [number, number, number, number];
export type Edition = {
  id: string;
  title: string;
  date: string;
  hash: string;
  pages: Box[];
  createdAt: string;
};
export type Annotation = {
  id: string;
  editionId: string;
  page: number;
  rects: Box[];
  kind: "highlight" | "underline" | "note";
  color: "yellow" | "green" | "blue" | "pink";
  quote: string;
  note: string;
  version: number;
  updatedAt: string;
};
export type Draft = Omit<Annotation, "version" | "updatedAt"> & {
  version?: number;
};
