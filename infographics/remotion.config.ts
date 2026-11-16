import { Config } from "@remotion/cli/config";

// docs/infographics.md §7. The CLI reads this file; scripts/render.ts adds the per-render flags.
Config.setEntryPoint("./src/index.ts");
// A piece's frozen snapshot is served from its own folder: staticFile("<piece>/data.json").
Config.setPublicDir("./pieces");
// PNG frames: flat colour and small text survive the trip into the video encoder.
Config.setVideoImageFormat("png");
Config.setStillImageFormat("png");
Config.setCodec("h264");
Config.setOverwriteOutput(true);

// The site's fonts live outside this package (src/app/fonts/). Emitted as files they render fine
// but are not served by Studio, so they are inlined into the bundle instead: about 94 KB in all,
// and the same bytes in Studio and in a render.
Config.overrideWebpackConfig((current) => ({
  ...current,
  module: {
    ...current.module,
    rules: (current.module?.rules ?? []).map((rule) =>
      rule && typeof rule === "object" && rule.test instanceof RegExp && rule.test.test("font.woff2")
        ? { ...rule, type: "asset/inline" }
        : rule
    ),
  },
}));
