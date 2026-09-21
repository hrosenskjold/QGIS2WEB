const CONFIG_KEY = "qgis2web_sync_config";

const DEFAULT_CONFIG = {
  owner: "hrosenskjold",
  repo: "QGIS2WEB",
  branch: "main",
  token: "",
  firebaseUrl: "",
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}) };
  } catch (err) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(newConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(newConfig));
}

let config = loadConfig();

// --- Kort ---
const map = L.map("map").setView([56.0, 10.0], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap-bidragydere",
}).addTo(map);

const PROJECT_KEY = "qgis2web_sync_project";

let harZoometTilData = false;
let aktiveLag = [];
let aktueltProjekt = localStorage.getItem(PROJECT_KEY) || "";

const layerControl = L.control.layers(null, null, { collapsed: false }).addTo(map);
const liveLayerGroup = L.layerGroup().addTo(map);
layerControl.addOverlay(liveLayerGroup, "Min position");

const projectSelect = document.getElementById("project-select");

// Cache-bustes, så et nyt "Publicér til web" fra QGIS slår igennem ved refresh.
function hentJson(sti) {
  return fetch(`${sti}?t=${Date.now()}`, { cache: "no-store" }).then((response) =>
    response.ok ? response.json() : null
  );
}

function rydLag() {
  aktiveLag.forEach((laget) => {
    layerControl.removeLayer(laget);
    map.removeLayer(laget);
  });
  aktiveLag = [];
}

function visProjekt(projektId) {
  rydLag();
  harZoometTilData = false;
  if (!projektId) return Promise.resolve();

  aktueltProjekt = projektId;
  localStorage.setItem(PROJECT_KEY, projektId);

  return hentJson(`data/projects/${projektId}/layers.geojson`)
    .then((geojson) => {
      const features = (geojson && geojson.features) || [];
      if (!features.length) return;

      const grupper = {};
      features.forEach((feature) => {
        const navn = (feature.properties && feature.properties._qgis_layer) || "Publicerede lag";
        (grupper[navn] = grupper[navn] || []).push(feature);
      });

      Object.keys(grupper)
        .sort()
        .forEach((navn) => {
          const laget = L.geoJSON(
            { type: "FeatureCollection", features: grupper[navn] },
            { pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 6 }) }
          ).addTo(map);
          layerControl.addOverlay(laget, `${navn} (${grupper[navn].length})`);
          aktiveLag.push(laget);
        });

      const bounds = L.featureGroup(aktiveLag).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 30] });
        harZoometTilData = true;
      }
    })
    .catch((err) => console.warn("Kunne ikke hente lag for projektet:", err));
}

function indlæsProjekter() {
  return hentJson("data/projects.json")
    .then((index) => {
      const projekter = (index && index.projects) || [];
      projectSelect.innerHTML = "";

      if (!projekter.length) {
        projectSelect.innerHTML = '<option value="">Ingen projekter endnu</option>';
        return;
      }

      projekter.forEach((projekt) => {
        const option = document.createElement("option");
        option.value = projekt.id;
        option.textContent = projekt.name || projekt.id;
        projectSelect.appendChild(option);
      });

      const valgt = projekter.some((projekt) => projekt.id === aktueltProjekt)
        ? aktueltProjekt
        : projekter[0].id;
      projectSelect.value = valgt;
      return visProjekt(valgt);
    })
    .catch((err) => console.warn("Kunne ikke hente projektlisten:", err));
}

projectSelect.addEventListener("change", () => visProjekt(projectSelect.value));
indlæsProjekter();

// --- Live position ---
const gpsStatus = document.getElementById("gps-status");
let liveMarker = null;

function updateFirebasePosition(lat, lon) {
  if (!config.firebaseUrl) return;
  const url = `${config.firebaseUrl.replace(/\/$/, "")}/positions/main.json`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, timestamp: new Date().toISOString() }),
  }).catch((err) => console.warn("Kunne ikke opdatere live position:", err));
}

function onPosition(position) {
  const { latitude, longitude } = position.coords;
  gpsStatus.textContent = `GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  if (!liveMarker) {
    liveMarker = L.circleMarker([latitude, longitude], {
      radius: 8,
      color: "#1a73e8",
      fillColor: "#1a73e8",
      fillOpacity: 0.9,
    }).addTo(liveLayerGroup);
    // Første GPS-fix centrerer kun kortet hvis der ikke allerede er zoomet til
    // publicerede lag – ellers hopper visningen væk fra dine data.
    if (!harZoometTilData) map.setView([latitude, longitude], 15);
  } else {
    liveMarker.setLatLng([latitude, longitude]);
  }

  updateFirebasePosition(latitude, longitude);
}

function onPositionError(err) {
  gpsStatus.textContent = `GPS-fejl: ${err.message}`;
}

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000,
  });
} else {
  gpsStatus.textContent = "GPS ikke understøttet af browseren.";
}

// --- Tilføj observation ---
const addBtn = document.getElementById("add-observation-btn");
const form = document.getElementById("observation-form");
const noteInput = document.getElementById("observation-note");
let pendingLatLng = null;
let placingObservation = false;

addBtn.addEventListener("click", () => {
  placingObservation = true;
  addBtn.textContent = "Klik på kortet…";
});

map.on("click", (event) => {
  if (!placingObservation) return;
  pendingLatLng = event.latlng;
  placingObservation = false;
  addBtn.textContent = "Tilføj observation her";
  form.classList.remove("hidden");
  noteInput.value = "";
  noteInput.focus();
});

document.getElementById("observation-cancel").addEventListener("click", () => {
  form.classList.add("hidden");
  pendingLatLng = null;
});

document.getElementById("observation-save").addEventListener("click", async () => {
  if (!pendingLatLng) return;
  const note = noteInput.value.trim();
  if (!note) {
    alert("Skriv venligst en note.");
    return;
  }
  try {
    await addObservation(pendingLatLng, note);
    form.classList.add("hidden");
    pendingLatLng = null;
    alert("Observation gemt og sendt til gennemgang i QGIS.");
  } catch (err) {
    alert(`Kunne ikke gemme observation: ${err.message}`);
  }
});

async function githubApi(path, options = {}) {
  const { owner, repo, token } = config;
  if (!owner || !repo || !token) {
    throw new Error("GitHub-indstillinger mangler – åbn indstillinger (⚙).");
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      ...(options.headers || {}),
    },
  });
}

function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function decodeBase64(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function addObservation(latlng, note) {
  if (!aktueltProjekt) {
    throw new Error("Vælg et projekt først.");
  }
  const path = `data/projects/${aktueltProjekt}/pending.geojson`;
  const branch = config.branch || "main";
  let sha = null;
  let existing = { type: "FeatureCollection", features: [] };

  const getResponse = await githubApi(`${path}?ref=${branch}`);
  if (getResponse.status === 200) {
    const payload = await getResponse.json();
    sha = payload.sha;
    existing = JSON.parse(decodeBase64(payload.content));
  } else if (getResponse.status !== 404) {
    throw new Error(`Kunne ikke hente ventende observationer (${getResponse.status})`);
  }

  existing.features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [latlng.lng, latlng.lat] },
    properties: { note, timestamp: new Date().toISOString() },
  });

  const body = {
    message: "Ny observation fra webkort",
    content: encodeBase64(JSON.stringify(existing, null, 2)),
    branch,
  };
  if (sha) body.sha = sha;

  const putResponse = await githubApi(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!putResponse.ok) {
    const text = await putResponse.text();
    throw new Error(`GitHub svarede ${putResponse.status}: ${text}`);
  }
}

// --- Indstillinger ---
const settingsPanel = document.getElementById("settings-panel");
document.getElementById("settings-toggle").addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

document.getElementById("cfg-owner").value = config.owner || "";
document.getElementById("cfg-repo").value = config.repo || "";
document.getElementById("cfg-branch").value = config.branch || "main";
document.getElementById("cfg-token").value = config.token || "";
document.getElementById("cfg-firebase").value = config.firebaseUrl || "";

document.getElementById("cfg-save").addEventListener("click", () => {
  config = {
    owner: document.getElementById("cfg-owner").value.trim(),
    repo: document.getElementById("cfg-repo").value.trim(),
    branch: document.getElementById("cfg-branch").value.trim() || "main",
    token: document.getElementById("cfg-token").value.trim(),
    firebaseUrl: document.getElementById("cfg-firebase").value.trim(),
  };
  saveConfig(config);
  settingsPanel.classList.add("hidden");
});

// --- PWA ---
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
