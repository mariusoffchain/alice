// Reviewed audit exceptions are tooling-only. Fail the web build if their
// packages ever enter the client module graph, including concatenated modules.
const FORBIDDEN_CLIENT_PACKAGES = /[/\\]node_modules[/\\](braces|node-forge)[/\\]/;

class WebClientBoundaryPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('WebClientBoundaryPlugin', (compilation) => {
      compilation.hooks.finishModules.tap('WebClientBoundaryPlugin', (modules) => {
        const seen = new Set();
        const visit = (module) => {
          if (seen.has(module)) return;
          seen.add(module);
          if (FORBIDDEN_CLIENT_PACKAGES.test(module.resource || '')) {
            compilation.errors.push(new Error(
              `Tooling-only audit exception entered the web client: ${module.resource}`,
            ));
          }
          if (module.modules) for (const child of module.modules) visit(child);
        };
        for (const module of modules) visit(module);
      });
    });
    compiler.hooks.done.tap('WebClientBoundaryPlugin', (stats) => {
      if (!stats.hasErrors()) console.log('Web client boundary passed: braces and node-forge are absent.');
    });
  }
}

module.exports = { WebClientBoundaryPlugin };
