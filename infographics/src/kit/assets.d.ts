// remotion.config.ts inlines an imported font file as a data URL.
declare module "*.woff2" {
  const url: string;
  export default url;
}
