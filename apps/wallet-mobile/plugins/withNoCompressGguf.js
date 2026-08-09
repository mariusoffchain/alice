const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withDangerousMod,
  withGradleProperties,
  withXcodeProject,
} = require('expo/config-plugins');

const BUNDLED_RAG_ASSETS = ['index.json', 'embeddings.f32'];
const NATIVE_RAG_ASSET_DIR = path.join('assets', 'core-embeddings');

function copyBundledRagAssets(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const filename of BUNDLED_RAG_ASSETS) {
    const source = path.join(sourceDir, filename);
    const target = path.join(targetDir, filename);
    if (!fs.existsSync(source)) {
      throw new Error(`Missing bundled semantic RAG asset: ${source}`);
    }
    const sourceStats = fs.statSync(source);
    const targetStats = fs.existsSync(target) ? fs.statSync(target) : null;
    if (!targetStats || targetStats.size !== sourceStats.size || targetStats.mtimeMs < sourceStats.mtimeMs) {
      fs.copyFileSync(source, target);
    }
  }
}

module.exports = function withNoCompressGguf(config) {
  // A clean install may not contain llama.rn's downloaded JNI archive. Build
  // the Android bindings from the package's bundled C++ sources so Local AI
  // cannot appear available in the UI while the native engine is absent.
  config = withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(item => item.key !== 'rnllamaBuildFromSource');
    cfg.modResults.push({
      type: 'property',
      key: 'rnllamaBuildFromSource',
      value: 'true',
    });
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const modelDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets', 'models');
      fs.rmSync(modelDir, { recursive: true, force: true });
      const ragSourceDir = path.join(cfg.modRequest.projectRoot, NATIVE_RAG_ASSET_DIR);
      const ragTargetDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets', 'core-embeddings');
      copyBundledRagAssets(ragSourceDir, ragTargetDir);

      return cfg;
    },
  ]);

  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const modelDir = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName, 'models');
      fs.rmSync(modelDir, { recursive: true, force: true });
      const ragSourceDir = path.join(cfg.modRequest.projectRoot, NATIVE_RAG_ASSET_DIR);
      const ragTargetDir = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName, 'core-embeddings');
      copyBundledRagAssets(ragSourceDir, ragTargetDir);

      return cfg;
    },
  ]);

  return withXcodeProject(config, (cfg) => {
    IOSConfig.XcodeUtils.ensureGroupRecursively(cfg.modResults, 'Resources');
    for (const filename of BUNDLED_RAG_ASSETS) {
      const resourcePath = `${cfg.modRequest.projectName}/core-embeddings/${filename}`;
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: resourcePath,
        groupName: 'Resources',
        project: cfg.modResults,
      });
    }
    return cfg;
  });
};
