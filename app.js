const CONFIG_KEY = "qgis2web_sync_config";
const PROJECT_KEY = "qgis2web_sync_project";
const BASEMAP_KEY = "qgis2web_sync_basemap";
const STANDARD_OBS_LAG = "Observationer";

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

// --- Kort og baggrundskort ---
const map = L.map("map").setView([56.0, 10.0], 6);

const baggrundskort = {
  OpenStreetMap: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap-bidragydere",
  }),
  Topografisk: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution:
      "Kortdata: &copy; OpenStreetMap-bidragydere, SRTM | Visning: &copy; OpenTopoMap (CC-BY-SA)",
  }),
  Luftfoto: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Luftfoto: &copy; Esri, Maxar, Earthstar Geographics" }
  ),
  "Intet baggrundskort": L.layerGroup(),
};

const gemtBaggrund = localStorage.getItem(BASEMAP_KEY);
(baggrundskort[gemtBaggrund] || baggrundskort.OpenStreetMap).addTo(map);
L.control.layers(baggrundskort, null, { collapsed: true }).addTo(map);
map.on("baselayerchange", (event) => localStorage.setItem(BASEMAP_KEY, event.name));

// Giver plads til de flydende knapper nederst til højre.
map.attributionControl.setPosition("bottomleft");

// Paneler og kortkontroller placeres efter topbjælkens faktiske højde, som
// ændrer sig når den ombrydes på smalle skærme.
function opdaterTopbjælkeHøjde() {
  const højde = document.getElementById("toolbar").offsetHeight;
  document.documentElement.style.setProperty("--topbjaelke", `${højde}px`);
}

window.addEventListener("resize", opdaterTopbjælkeHøjde);
window.addEventListener("orientationchange", opdaterTopbjælkeHøjde);
opdaterTopbjælkeHøjde();

// --- Tilstand ---
let harZoometTilData = false;
let aktueltProjekt = localStorage.getItem(PROJECT_KEY) || "";
let projektListe = [];
let panelLag = [];
let obsLagPrNavn = {};
let aktivtObsLag = STANDARD_OBS_LAG;

const projectSelect = document.getElementById("project-select");

// Cache-bustes, så et nyt "Publicér til web" fra QGIS slår igennem ved refresh.
function hentJson(sti) {
  return fetch(`${sti}?t=${Date.now()}`, { cache: "no-store" }).then((response) =>
    response.ok ? response.json() : null
  );
}

// --- Labels og popups ---
// Alt tekstindhold sættes via textContent og style-egenskaber, aldrig via
// innerHTML, så skrifttypenavne og attributværdier fra QGIS ikke kan injicere
// markup i siden.
function labelElement(label) {
  const span = document.createElement("span");
  span.textContent = label.text;
  span.style.color = label.color;
  span.style.fontSize = `${label.size}px`;
  span.style.fontFamily = `${label.family}, sans-serif`;
  span.style.fontWeight = label.bold ? "bold" : "normal";
  span.style.fontStyle = label.italic ? "italic" : "normal";
  if (label.haloColor) {
    const radius = `${label.haloSize || 2}px`;
    const skygge = `0 0 ${radius} ${label.haloColor}`;
    span.style.textShadow = `${skygge}, ${skygge}, ${skygge}`;
  }
  return span;
}

function popupElement(props) {
  const tabel = document.createElement("table");
  tabel.className = "popup-tabel";
  Object.keys(props)
    .filter((navn) => !navn.startsWith("_qgis"))
    .forEach((navn) => {
      const række = tabel.insertRow();
      række.insertCell().textContent = navn;
      const værdi = props[navn];
      række.insertCell().textContent =
        værdi === null || værdi === undefined ? "" : String(værdi);
    });
  return tabel;
}

function sætLabels(post, til) {
  post.labels = til;
  post.lag.eachLayer((featureLag) => {
    const label = ((featureLag.feature || {}).properties || {})._qgis_label;
    if (!label) return;
    if (til) {
      featureLag.bindTooltip(labelElement(label), {
        permanent: true,
        direction: "center",
        className: "qgis-label",
      });
    } else {
      featureLag.unbindTooltip();
    }
  });
}

function sætPopups(post, til) {
  post.popup = til;
  post.lag.eachLayer((featureLag) => {
    const props = (featureLag.feature || {}).properties || {};
    if (til) {
      featureLag.bindPopup(popupElement(props));
    } else {
      featureLag.unbindPopup();
    }
  });
}

// --- Lagpanel ---
function afkrydsningsCelle(afkrydset, deaktiveret, onChange) {
  const celle = document.createElement("td");
  const boks = document.createElement("input");
  boks.type = "checkbox";
  boks.checked = afkrydset;
  boks.disabled = deaktiveret;
  boks.addEventListener("change", () => onChange(boks.checked));
  celle.appendChild(boks);
  return celle;
}

function tegnLagpanel() {
  const krop = document.querySelector("#layer-table tbody");
  krop.innerHTML = "";

  panelLag.forEach((post) => {
    const række = document.createElement("tr");
    const navnCelle = document.createElement("td");
    navnCelle.textContent = post.navn;
    navnCelle.className = "lag-navn";
    række.appendChild(navnCelle);

    række.appendChild(
      afkrydsningsCelle(post.synlig, false, (til) => {
        post.synlig = til;
        if (til) map.addLayer(post.lag);
        else map.removeLayer(post.lag);
      })
    );
    række.appendChild(
      afkrydsningsCelle(post.labels, !post.harLabels, (til) => sætLabels(post, til))
    );
    række.appendChild(
      afkrydsningsCelle(post.popup, post.popupLåst, (til) => sætPopups(post, til))
    );

    krop.appendChild(række);
  });
}

function registrerLag(post) {
  panelLag.push(post);
  tegnLagpanel();
}

function rydLag() {
  panelLag
    .filter((post) => !post.erObservation && !post.fast)
    .forEach((post) => map.removeLayer(post.lag));
  panelLag = panelLag.filter((post) => post.erObservation || post.fast);
  tegnLagpanel();
}

// --- Observationer ---
function obsLagFor(navn) {
  if (!obsLagPrNavn[navn]) {
    const laget = L.geoJSON(null, {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 7,
          color: "#a34700",
          fillColor: "#ff9800",
          fillOpacity: 0.9,
          weight: 2,
        }),
      onEachFeature: (feature, featureLag) => {
        const props = feature.properties || {};
        const indhold = document.createElement("div");

        const overskrift = document.createElement("strong");
        overskrift.textContent = props._obs_layer || STANDARD_OBS_LAG;
        indhold.appendChild(overskrift);

        const note = document.createElement("div");
        note.textContent = props.note || "";
        indhold.appendChild(note);

        const tid = document.createElement("small");
        tid.textContent = props.timestamp || "";
        indhold.appendChild(tid);

        const sletKnap = document.createElement("button");
        sletKnap.textContent = "Slet observation";
        sletKnap.className = "slet-knap";
        sletKnap.addEventListener("click", async () => {
          if (!confirm("Slet denne observation?")) return;
          sletKnap.disabled = true;
          try {
            await sletObservation(feature);
            laget.removeLayer(featureLag);
            map.closePopup();
          } catch (err) {
            sletKnap.disabled = false;
            alert(`Kunne ikke slette: ${err.message}`);
          }
        });
        indhold.appendChild(sletKnap);

        featureLag.bindPopup(indhold);
      },
    }).addTo(map);

    obsLagPrNavn[navn] = laget;
    registrerLag({
      navn: `${navn} (observationer)`,
      lag: laget,
      synlig: true,
      labels: false,
      popup: true,
      harLabels: false,
      popupLåst: true,
      erObservation: true,
    });
  }
  return obsLagPrNavn[navn];
}

function rydObservationer() {
  Object.keys(obsLagPrNavn).forEach((navn) => map.removeLayer(obsLagPrNavn[navn]));
  obsLagPrNavn = {};
  panelLag = panelLag.filter((post) => !post.erObservation);
  tegnLagpanel();
}

function visObservationer(projektId) {
  return hentJson(`data/projects/${projektId}/pending.geojson`)
    .then((geojson) => {
      ((geojson && geojson.features) || []).forEach((feature) => {
        const navn = (feature.properties && feature.properties._obs_layer) || STANDARD_OBS_LAG;
        obsLagFor(navn).addData(feature);
      });
    })
    .catch((err) => console.warn("Kunne ikke hente observationer:", err));
}

// --- Projekter ---
function visProjekt(projektId) {
  rydLag();
  rydObservationer();
  harZoometTilData = false;
  if (!projektId) return Promise.resolve();

  aktueltProjekt = projektId;
  localStorage.setItem(PROJECT_KEY, projektId);

  const projekt = projektListe.find((post) => post.id === projektId);
  aktivtObsLag = (projekt && projekt.obsLayer) || STANDARD_OBS_LAG;
  opdaterObsLagFelt();

  visObservationer(projektId);

  return hentJson(`data/projects/${projektId}/layers.geojson`)
    .then((geojson) => {
      const features = (geojson && geojson.features) || [];
      if (!features.length) return;

      const grupper = {};
      features.forEach((feature) => {
        const navn = (feature.properties && feature.properties._qgis_layer) || "Publicerede lag";
        (grupper[navn] = grupper[navn] || []).push(feature);
      });

      const tilføjede = [];
      Object.keys(grupper)
        .sort()
        .forEach((navn) => {
          const laget = L.geoJSON(
            { type: "FeatureCollection", features: grupper[navn] },
            {
              // _qgis_style er allerede Leaflet Path-options, sat af eksportøren.
              style: (feature) => (feature.properties && feature.properties._qgis_style) || {},
              pointToLayer: (feature, latlng) =>
                L.circleMarker(
                  latlng,
                  (feature.properties && feature.properties._qgis_style) || { radius: 6 }
                ),
            }
          ).addTo(map);

          const harLabels = grupper[navn].some(
            (feature) => feature.properties && feature.properties._qgis_label
          );
          const post = {
            navn: `${navn} (${grupper[navn].length})`,
            lag: laget,
            synlig: true,
            labels: harLabels,
            popup: true,
            harLabels,
            popupLåst: false,
            erObservation: false,
          };
          registrerLag(post);
          // Labels følger QGIS: er de slået til der, vises de også her.
          if (harLabels) sætLabels(post, true);
          sætPopups(post, true);
          tilføjede.push(laget);
        });

      const bounds = L.featureGroup(tilføjede).getBounds();
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
      projektListe = projekter;
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

document.getElementById("layer-panel-toggle").addEventListener("click", () => {
  const tabel = document.getElementById("layer-table");
  const skjult = tabel.classList.toggle("hidden");
  document.getElementById("layer-panel-toggle").textContent = skjult ? "+" : "−";
});

indlæsProjekter();

// --- Live position ---
const gpsStatus = document.getElementById("gps-status");
const liveLayerGroup = L.layerGroup().addTo(map);
let liveMarker = null;
let sidstePosition = null;

registrerLag({
  navn: "Min position",
  lag: liveLayerGroup,
  synlig: true,
  labels: false,
  popup: false,
  harLabels: false,
  popupLåst: true,
  erObservation: false,
  fast: true,
});

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
  sidstePosition = [latitude, longitude];
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

document.getElementById("locate-btn").addEventListener("click", () => {
  if (sidstePosition) {
    map.setView(sidstePosition, Math.max(map.getZoom(), 17));
    return;
  }
  if (!("geolocation" in navigator)) {
    alert("GPS er ikke understøttet af denne browser.");
    return;
  }
  // Der er endnu ikke kommet et fix fra watchPosition – bed om ét med det samme.
  gpsStatus.textContent = "GPS: finder position…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      onPosition(position);
      map.setView([position.coords.latitude, position.coords.longitude], 17);
    },
    (err) => {
      onPositionError(err);
      alert(`Kunne ikke finde din position: ${err.message}`);
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

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
  addBtn.textContent = "+ Observation";
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

// --- GitHub ---
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

  const nyFeature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [latlng.lng, latlng.lat] },
    properties: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      note,
      timestamp: new Date().toISOString(),
      _obs_layer: aktivtObsLag,
    },
  };
  existing.features.push(nyFeature);

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

  // Vises med det samme: GitHub Pages er først opdateret efter næste build,
  // så en genindlæsning af pending.geojson ville ikke have den med endnu.
  obsLagFor(aktivtObsLag).addData(nyFeature);
}

function sammeObservation(kandidat, props) {
  const andre = kandidat.properties || {};
  if (props.id || andre.id) return andre.id === props.id;
  // Observationer fra før id'er blev indført matches på tidsstempel og note.
  return andre.timestamp === props.timestamp && andre.note === props.note;
}

async function sletObservation(feature) {
  if (!aktueltProjekt) throw new Error("Intet projekt valgt.");
  const path = `data/projects/${aktueltProjekt}/pending.geojson`;
  const branch = config.branch || "main";

  const getResponse = await githubApi(`${path}?ref=${branch}`);
  if (getResponse.status !== 200) {
    throw new Error(`Kunne ikke hente ventelisten (${getResponse.status})`);
  }
  const payload = await getResponse.json();
  const data = JSON.parse(decodeBase64(payload.content));

  const props = feature.properties || {};
  data.features = (data.features || []).filter((post) => !sammeObservation(post, props));

  const putResponse = await githubApi(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Slet observation fra webkort",
      content: encodeBase64(JSON.stringify(data, null, 2)),
      branch,
      sha: payload.sha,
    }),
  });
  if (!putResponse.ok) {
    throw new Error(`GitHub svarede ${putResponse.status}`);
  }
}

async function sætObsLagForProjekt(projektId, navn) {
  const path = "data/projects.json";
  const branch = config.branch || "main";

  const getResponse = await githubApi(`${path}?ref=${branch}`);
  if (getResponse.status !== 200) {
    throw new Error(`Kunne ikke hente projektlisten (${getResponse.status})`);
  }
  const payload = await getResponse.json();
  const index = JSON.parse(decodeBase64(payload.content));

  const projekt = (index.projects || []).find((post) => post.id === projektId);
  if (!projekt) throw new Error("Projektet findes ikke i indekset.");
  projekt.obsLayer = navn;

  const putResponse = await githubApi(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Nyt observationslag '${navn}' i ${projekt.name || projektId}`,
      content: encodeBase64(JSON.stringify(index, null, 2)),
      branch,
      sha: payload.sha,
    }),
  });
  if (!putResponse.ok) {
    throw new Error(`GitHub svarede ${putResponse.status}`);
  }
  projektListe = index.projects || [];
}

// --- Indstillinger ---
const settingsPanel = document.getElementById("settings-panel");
document.getElementById("settings-toggle").addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

function opdaterObsLagFelt() {
  const felt = document.getElementById("cfg-obslayer");
  if (felt) felt.value = aktivtObsLag;
}

document.getElementById("obslayer-new").addEventListener("click", async () => {
  if (!aktueltProjekt) {
    alert("Vælg et projekt først.");
    return;
  }
  const navn = prompt("Navn på nyt observationslag:", "");
  if (!navn || !navn.trim()) return;

  try {
    await sætObsLagForProjekt(aktueltProjekt, navn.trim());
    aktivtObsLag = navn.trim();
    opdaterObsLagFelt();
    obsLagFor(aktivtObsLag);
    alert(`Nye observationer registreres nu i '${aktivtObsLag}'.`);
  } catch (err) {
    alert(`Kunne ikke oprette observationslag: ${err.message}`);
  }
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
