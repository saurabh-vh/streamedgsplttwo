var GsplatLodStreamingTwo = pc.createScript('gsplatLodStreamingTwo');

// --- 1. CORE ATTRIBUTES ---
GsplatLodStreamingTwo.attributes.add('url', { type: 'string', default: 'https://code.playcanvas.com/examples_data/example_roman_parish_02/lod-meta.json', title: 'GSplat URL' });
GsplatLodStreamingTwo.attributes.add('orientation', { type: 'number', default: 270, title: 'Orientation (Euler X)' });
GsplatLodStreamingTwo.attributes.add('autoPerformance', { type: 'boolean', default: true, title: 'Auto FPS Scaling' });

// --- 2. DYNAMIC BUDGET SETTINGS (balanced for mobile) ---
GsplatLodStreamingTwo.attributes.add('maxSplatBudget', { type: 'number', default: 8.0, title: 'Max Budget (Millions)' });
GsplatLodStreamingTwo.attributes.add('fpsDropThreshold', { type: 'number', default: 30, title: 'FPS Drop Threshold' });
GsplatLodStreamingTwo.attributes.add('fpsClimbThreshold', { type: 'number', default: 45, title: 'FPS Climb Threshold' });
GsplatLodStreamingTwo.attributes.add('lodUpdateDistance', { type: 'number', default: 1.5, title: 'LOD Update Distance' });
GsplatLodStreamingTwo.attributes.add('lodUnderfillLimit', { type: 'number', default: 5, title: 'LOD Underfill Limit' });

// --- 3. RENDERING & DEBUG ---
GsplatLodStreamingTwo.attributes.add('showStats', { type: 'boolean', default: true, title: 'Show FPS/Stats UI' });
GsplatLodStreamingTwo.attributes.add('renderer', { type: 'number', title: 'Renderer Type', enum: [{ 'Auto': 0 }, { 'Quad': 1 }, { 'Compute': 2 }], default: 0 });
GsplatLodStreamingTwo.attributes.add('debugMode', { type: 'number', title: 'Debug Mode', enum: [{ 'None': 0 }, { 'LOD': 1 }, { 'SH update': 2 }, { 'Heatmap': 3 }], default: 0 });
GsplatLodStreamingTwo.attributes.add('compact', { type: 'boolean', default: true, title: 'Compact Data Format' });
GsplatLodStreamingTwo.attributes.add('radialSorting', { type: 'boolean', default: true, title: 'Radial Sorting' });
GsplatLodStreamingTwo.attributes.add('minPixelSize', { type: 'number', default: 2, title: 'Min Pixel Size' });
GsplatLodStreamingTwo.attributes.add('minContribution', { type: 'number', default: 3, title: 'Min Contribution' });
GsplatLodStreamingTwo.attributes.add('highRes', { type: 'boolean', default: false, title: 'High Res (DPR)' });
GsplatLodStreamingTwo.attributes.add('occluder', { type: 'boolean', default: false, title: 'Show Occluder Cube' });

// --- 4. CAMERA & ENVIRONMENT ---
GsplatLodStreamingTwo.attributes.add('cameraFov', { type: 'number', default: 75, title: 'Camera FOV' });
GsplatLodStreamingTwo.attributes.add('fisheye', { type: 'number', default: 0, title: 'Fisheye Distortion' });
GsplatLodStreamingTwo.attributes.add('exposure', { type: 'number', default: 1, title: 'Exposure' });
GsplatLodStreamingTwo.attributes.add('fogDensity', { type: 'number', default: 0, title: 'Fog Density' });
GsplatLodStreamingTwo.attributes.add('environment', {
    type: 'string', title: 'HDRI Environment',
    enum: [
        { 'None': 'none' }, { 'Rosendal Park': 'rosendal' }, { 'Industrial Sunset': 'industrial-sunset' },
        { 'Partly Cloudy': 'partly-cloudy' }, { 'Moonlit': 'moonlit' }, { 'Sunflowers': 'sunflowers' },
        { 'Table Mountain': 'table-mountain' }, { 'Cloud Layers': 'cloud-layers' }, { 'Night': 'night' }
    ], default: 'none'
});

GsplatLodStreamingTwo.prototype.initialize = function () {
    this.defaultSkybox = this.app.scene.skybox;
    this.defaultEnvAtlas = this.app.scene.envAtlas;

    // No high performance mode – start at medium quality (2M splats)
    this.minBudget = 2.0;                     // start at 2 million splats (visible medium LOD)
    this.currentBudget = this.minBudget;
    this.budgetClimbStep = 0.5;               // climb 0.5M per second when FPS is good
    this.budgetDropStep = 1.0;                // drop 1.0M per second when FPS drops

    // Quality bounds – allow LOD levels to be visible
    this.qualityBounds = {
        minBaseDist: 8, maxBaseDist: 100000,      // LOD base distance range
        minMultiplier: 3, maxMultiplier: 1.5  // LOD multiplier range
    };

    // FPS tracking
    this.fpsTimer = 0;
    this.frameCount = 0;
    this.lastFps = 0;
    this.stableFrames = 0;

    // Dynamic pixel scaling (FPS‑based)
    this.dynamicPixelFactor = 1.0;

    // GSplat core config – ensure all LOD levels are accessible
    this.app.scene.gsplat.lodUpdateAngle = 90;
    this.app.scene.gsplat.lodBehindPenalty = 3;
    this.app.scene.gsplat.lodRangeMin = 0;    // allow lowest LOD
    this.app.scene.gsplat.lodRangeMax = 5;    // allow highest LOD (if available)

    this.config = { cameraPosition: [10.3, 2, -10], focusPoint: [12, 3, 0], moduleRoot: 'https://code.playcanvas.com' };
    this.hdriCache = new Map();

    // UI & Setup
    if (this.showStats) this.loadMiniStats();
    this.setupPresetUI();
    this.setupCamera();
    this.setupOccluder();

    this.gsplatEntity = new pc.Entity('GSplat-Container');
    this.entity.addChild(this.gsplatEntity);

    this.applyAllSettings();
    this.loadGsplat(this.url);
    this.bindEvents();

    this.on('destroy', function () { if (this.presetUI) this.presetUI.remove(); }, this);
};

// --- DYNAMIC PERFORMANCE EVALUATION ---
GsplatLodStreamingTwo.prototype.update = function (dt) {
    if (!this.autoPerformance) return;

    this.fpsTimer += dt;
    this.frameCount++;

    if (this.fpsTimer >= 1.0) {
        this.lastFps = Math.round(this.frameCount / this.fpsTimer);
        this.evaluateDynamicPerformance(this.lastFps);
        this.fpsTimer = 0;
        this.frameCount = 0;
        this.updatePresetUI();
    }
};

GsplatLodStreamingTwo.prototype.evaluateDynamicPerformance = function (fps) {
    let changed = false;
    const currentCeiling = this.maxSplatBudget;

    // 1. Dynamic pixel ratio scaling based on FPS thresholds
    let newFactor = 1.0;
    if (fps < 10) newFactor = 0.2;
    else if (fps < 15) newFactor = 0.5;
    else if (fps < 20) newFactor = 0.8;
    else newFactor = 1.0;
    if (this.dynamicPixelFactor !== newFactor) {
        this.dynamicPixelFactor = newFactor;
        this.applyResolution();
    }

    // 2. Adjust splat budget
    if (fps < this.fpsDropThreshold) {
        if (this.currentBudget > this.minBudget) {
            this.currentBudget = Math.max(this.minBudget, this.currentBudget - this.budgetDropStep);
            this.stableFrames = 0;
            changed = true;
        }
    }
    else if (fps >= this.fpsClimbThreshold) {
        this.stableFrames++;
        if (this.stableFrames >= 1 && this.currentBudget < currentCeiling) {
            this.currentBudget = Math.min(currentCeiling, this.currentBudget + this.budgetClimbStep);
            this.stableFrames = 0;
            changed = true;
        }
    }
    else {
        this.stableFrames++;
    }

    if (changed) {
        this.applyDynamicQuality();
    }
};

GsplatLodStreamingTwo.prototype.applyDynamicQuality = function () {
    // Set splat budget (number of splats to render)
    this.app.scene.gsplat.splatBudget = Math.round(this.currentBudget * 1000000);

    // Interpolate LOD parameters between min and max quality bounds
    let ratio = (this.currentBudget - this.minBudget) / (this.maxSplatBudget - this.minBudget);
    ratio = Math.max(0, Math.min(1, ratio || 0));

    let newBaseDist = this.qualityBounds.minBaseDist + ratio * (this.qualityBounds.maxBaseDist - this.qualityBounds.minBaseDist);
    let newMultiplier = this.qualityBounds.minMultiplier + ratio * (this.qualityBounds.maxMultiplier - this.qualityBounds.minMultiplier);

    if (this.gsplatGs) {
        this.gsplatGs.lodBaseDistance = Math.round(newBaseDist);
        this.gsplatGs.lodMultiplier = newMultiplier;
    }
};

// --- DOM UI (no high perf mode button) ---
GsplatLodStreamingTwo.prototype.setupPresetUI = function () {
    this.presetUI = document.createElement('div');
    Object.assign(this.presetUI.style, {
        position: 'fixed', top: '10px', right: '10px', background: 'rgba(0, 0, 0, 0.75)',
        color: '#fff', padding: '10px 14px', fontFamily: 'monospace', fontSize: '13px',
        borderRadius: '6px', zIndex: '1000', pointerEvents: 'none',
        boxShadow: '0 2px 5px rgba(0,0,0,0.5)', whiteSpace: 'pre', lineHeight: '1.4'
    });
    document.body.appendChild(this.presetUI);
    this.updatePresetUI();
};

GsplatLodStreamingTwo.prototype.updatePresetUI = function () {
    if (!this.presetUI) return;
    let autoStatus = this.autoPerformance ? "ON (" + this.lastFps + " FPS)" : "OFF (MANUAL)";
    let baseDist = this.gsplatGs ? this.gsplatGs.lodBaseDistance : 0;
    let budgetM = this.currentBudget.toFixed(1);
    this.presetUI.innerText =
        'DYNAMIC LOD : ' + autoStatus + '\n' +
        'BUDGET      : ' + budgetM + 'M\n' +
        'BASE DIST   : ' + baseDist + '\n' +
        'PIXEL RATIO : ' + (this.app.graphicsDevice.maxPixelRatio).toFixed(2) + 'x';
};

// --- Mini Stats (optional) ---
GsplatLodStreamingTwo.prototype.loadMiniStats = function () {
    var app = this.app;
    if (pc.MiniStats) {
        new pc.MiniStats(app, pc.MiniStats.getDefaultOptions(['gsplats', 'gsplatsCopy']));
    } else {
        var script = document.createElement('script');
        script.src = 'https://code.playcanvas.com/playcanvas-extras.js';
        script.onload = function () { new pc.MiniStats(app, pc.MiniStats.getDefaultOptions(['gsplats', 'gsplatsCopy'])); };
        document.head.appendChild(script);
    }
};

// --- Camera Setup ---
GsplatLodStreamingTwo.prototype.setupCamera = function () {
    this.cameraEntity = this.entity.camera ? this.entity : this.app.root.findByName('Camera');
    if (!this.cameraEntity) {
        this.cameraEntity = new pc.Entity('Camera');
        this.cameraEntity.addComponent('camera', {
            clearColor: new pc.Color(1, 1, 1),
            toneMapping: pc.TONEMAP_LINEAR,
            nearClip: 0.02
        });
        this.app.root.addChild(this.cameraEntity);
    } else {
        this.cameraEntity.camera.nearClip = 0.02;
    }
    this.cameraEntity.setLocalPosition(this.config.cameraPosition[0], this.config.cameraPosition[1], this.config.cameraPosition[2]);
    var focus = new pc.Vec3(this.config.focusPoint[0], this.config.focusPoint[1], this.config.focusPoint[2]);
    this.cameraEntity.lookAt(focus);
    var self = this;
    import(this.config.moduleRoot + '/static/scripts/esm/camera-controls.mjs').then(function (module) {
        if (!self.cameraEntity.script) self.cameraEntity.addComponent('script');
        var cc = self.cameraEntity.script.create(module.CameraControls);
        Object.assign(cc, { sceneSize: 500, moveSpeed: 4, moveFastSpeed: 15, enableOrbit: false, enablePan: false, focusPoint: focus });
    }).catch(function (e) { console.warn("Could not load CameraControls", e); });
};

// --- Occluder Cube ---
GsplatLodStreamingTwo.prototype.setupOccluder = function () {
    this.cube = new pc.Entity('orange-cube');
    this.cube.addComponent('render', { type: 'box' });
    var orangeMat = new pc.StandardMaterial();
    orangeMat.diffuse = new pc.Color(0, 0, 0);
    orangeMat.emissive = new pc.Color(1, 0.5, 0);
    orangeMat.update();
    this.cube.render.meshInstances[0].material = orangeMat;
    this.cube.setLocalPosition(6, 1, -2);
    this.cube.setLocalScale(2, 2, 2);
    this.cube.enabled = this.occluder;
    this.app.root.addChild(this.cube);
};

// --- Load GSplat Asset ---
GsplatLodStreamingTwo.prototype.loadGsplat = function (url) {
    if (!url) return;
    var app = this.app;
    var self = this;
    if (this.customAsset) {
        app.assets.remove(this.customAsset);
        this.customAsset.unload();
    }
    this.customAsset = new pc.Asset('gsplat-meta', 'gsplat', { url: url });
    app.assets.add(this.customAsset);
    this.customAsset.ready(function (loadedAsset) {
        if (self.gsplatEntity.gsplat) self.gsplatEntity.removeComponent('gsplat');
        self.gsplatEntity.addComponent('gsplat', { asset: loadedAsset, unified: true });
        self.gsplatEntity.setLocalEulerAngles(self.orientation, 0, 0);
        self.gsplatGs = self.gsplatEntity.gsplat;
        self.applyDynamicQuality();
        // Ensure LOD range is set after loading
        var lodLevels = self.gsplatGs.resource && self.gsplatGs.resource.octree ? self.gsplatGs.resource.octree.lodLevels : null;
        if (lodLevels) {
            app.scene.gsplat.lodRangeMin = 0;
            app.scene.gsplat.lodRangeMax = lodLevels - 1;
        }
        var onFrameReady = function (cam, layer, ready, loadingCount) {
            if (ready && loadingCount === 0) {
                app.systems.gsplat.off('frame:ready', onFrameReady);
                self.applyDynamicQuality();
            }
        };
        app.systems.gsplat.on('frame:ready', onFrameReady);
        import(self.config.moduleRoot + '/static/scripts/esm/gsplat/reveal-radial.mjs').then(function (module) {
            if (!self.gsplatEntity.script) self.gsplatEntity.addComponent('script');
            var revealScript = self.gsplatEntity.script.create(module.GsplatRevealRadial);
            if (revealScript) {
                revealScript.center.set(self.config.focusPoint[0], self.config.focusPoint[1], self.config.focusPoint[2]);
                Object.assign(revealScript, { speed: 5, acceleration: 0, delay: 3, oscillationIntensity: 0.2, endRadius: 25 });
            }
        });
    });
    app.assets.load(this.customAsset);
};

// --- Apply All Settings ---
GsplatLodStreamingTwo.prototype.applyAllSettings = function () {
    this.applyResolution();
    this.applyFov();
    this.applyEnvironment();
    this.applyDynamicQuality();
    var g = this.app.scene.gsplat;
    g.radialSorting = this.radialSorting;
    g.minPixelSize = this.minPixelSize;
    g.minContribution = this.minContribution;
    g.lodUpdateDistance = this.lodUpdateDistance;
    g.lodUnderfillLimit = this.lodUnderfillLimit;
    g.dataFormat = this.compact ? pc.GSPLATDATA_COMPACT : pc.GSPLATDATA_LARGE;
    g.renderer = this.renderer;
    g.debug = this.debugMode;
    g.fisheye = this.fisheye;
    this.app.scene.sky.fisheye = this.fisheye;
    this.app.scene.exposure = this.exposure;
    this.applyFog();
};

// --- Resolution Scaling (includes dynamic FPS factor) ---
GsplatLodStreamingTwo.prototype.applyResolution = function () {
    let dpr = window.devicePixelRatio || 1;
    let basePixelScale = this.highRes ? Math.min(dpr, 2) : (dpr >= 2 ? dpr * 0.5 : dpr);
    this.app.graphicsDevice.maxPixelRatio = basePixelScale * this.dynamicPixelFactor;
    this.app.resizeCanvas();
    if (this.presetUI) this.updatePresetUI();
};

// --- FOV ---
GsplatLodStreamingTwo.prototype.applyFov = function () {
    this.cameraEntity.camera.fov = (this.fisheye === 0) ? Math.min(this.cameraFov, 140) : this.cameraFov;
};

// --- Fog ---
GsplatLodStreamingTwo.prototype.applyFog = function () {
    if (this.fogDensity > 0) {
        this.app.scene.fog.type = pc.FOG_EXP;
        this.app.scene.fog.density = this.fogDensity;
        this.app.scene.fog.color.copy(this.cameraEntity.camera.clearColor);
    } else {
        this.app.scene.fog.type = pc.FOG_NONE;
    }
};

// --- Environment (HDRI) ---
GsplatLodStreamingTwo.prototype.applyEnvironment = function () {
    var ENV_PRESETS = {
        'none': null, 'rosendal': { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/rosendal_park_sunset_puresky_2k.hdr', exposure: 0.06 },
        'industrial-sunset': { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/industrial_sunset_puresky_2k.hdr', exposure: 0.8 },
        'partly-cloudy': { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr', exposure: 0.9 },
        'moonlit': { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_moon_noon_puresky_2k.hdr', exposure: 0.4 },
        'sunflowers': { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/sunflowers_puresky_2k.hdr', exposure: 0.8 },
        'table-mountain': { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/table_mountain_2_puresky_2k.hdr', exposure: 1 },
        'cloud-layers': { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/cloud_layers_2k.hdr', exposure: 1 },
        'night': { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_night_puresky_2k.hdr', exposure: 0.2 }
    };
    var preset = ENV_PRESETS[this.environment];
    if (!preset) {
        this.app.scene.skybox = this.defaultSkybox || null;
        this.app.scene.envAtlas = this.defaultEnvAtlas || null;
        return;
    }
    var app = this.app;
    if (!this.hdriCache.has(preset.url)) {
        var asset = new pc.Asset('hdri', 'texture', { url: preset.url }, { mipmaps: false });
        var self = this;
        asset.ready(function (loadedAsset) {
            var source = loadedAsset.resource;
            var skybox = pc.EnvLighting.generateSkyboxCubemap(source);
            var lighting = pc.EnvLighting.generateLightingSource(source);
            var envAtlas = pc.EnvLighting.generateAtlas(lighting);
            lighting.destroy();
            self.hdriCache.set(preset.url, { skybox: skybox, envAtlas: envAtlas });
            app.scene.skybox = skybox; app.scene.envAtlas = envAtlas; app.scene.sky.type = pc.SKYTYPE_INFINITE;
        });
        app.assets.add(asset); app.assets.load(asset);
    } else {
        var cached = this.hdriCache.get(preset.url);
        app.scene.skybox = cached.skybox; app.scene.envAtlas = cached.envAtlas; app.scene.sky.type = pc.SKYTYPE_INFINITE;
    }
};

// --- Event Bindings ---
GsplatLodStreamingTwo.prototype.bindEvents = function () {
    this.on('attr:autoPerformance', this.updatePresetUI, this);
    this.on('attr:url', function (v) { this.loadGsplat(v); }, this);
    this.on('attr:orientation', function (v) { if (this.gsplatEntity) this.gsplatEntity.setLocalEulerAngles(v, 0, 0); }, this);
    this.on('attr:cameraFov', this.applyFov, this);
    this.on('attr:fisheye', function (v) { this.app.scene.gsplat.fisheye = v; this.app.scene.sky.fisheye = v; this.applyFov(); }, this);
    this.on('attr:exposure', function (v) { this.app.scene.exposure = v; }, this);
    this.on('attr:fogDensity', this.applyFog, this);
    this.on('attr:environment', this.applyEnvironment, this);
    this.on('attr:radialSorting', function (v) { this.app.scene.gsplat.radialSorting = v; }, this);
    this.on('attr:minPixelSize', function (v) { this.app.scene.gsplat.minPixelSize = v; }, this);
    this.on('attr:minContribution', function (v) { this.app.scene.gsplat.minContribution = v; }, this);
    this.on('attr:compact', function (v) { this.app.scene.gsplat.dataFormat = v ? pc.GSPLATDATA_COMPACT : pc.GSPLATDATA_LARGE; }, this);
    this.on('attr:renderer', function (v) { this.app.scene.gsplat.renderer = v; }, this);
    this.on('attr:debugMode', function (v) { this.app.scene.gsplat.debug = v; }, this);
    this.on('attr:lodUpdateDistance', function (v) { this.app.scene.gsplat.lodUpdateDistance = v; }, this);
    this.on('attr:lodUnderfillLimit', function (v) { this.app.scene.gsplat.lodUnderfillLimit = v; }, this);
    this.on('attr:highRes', this.applyResolution, this);
    this.on('attr:occluder', function (v) { this.cube.enabled = v; }, this);
};
