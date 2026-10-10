"use strict";

/* =========================================================
   GAME CONFIGURATION
========================================================= */

const CONFIG = Object.freeze({
  roundsPerGame: 5,
  maxRoundScore: 5000,

  // Province-scale scoring curve.
  scoreDecayKm: 20,

  // Keep Street View searches close to the generated seed.
  panoramaSearchRadiusM: 800,
  panoramaSnapLimitM: 900,

  // Prevent consecutive rounds from being nearly identical.
  minRoundSeparationM: 6000,

  // Search budget before restarting location generation.
  maxAreaAttempts: 12,
  seedAttemptsPerArea: 5,

  mapCenter: Object.freeze({
    lat: 13.20,
    lng: 123.65
  }),

  mapZoom: 9,

  /*
    Albay-specific distribution.
    Most locations intentionally favor poblacion/sentro and built-up roads.
  */
  locationMix: Object.freeze({
    urban: 0.82,
    outskirts: 0.15,
    rural: 0.03
  }),

  /*
    Rough mainland-Albay safety bounds.
    Used only to reject panoramas that snap outside the intended map.
  */
  albayBounds: Object.freeze({
    north: 13.52,
    south: 12.95,
    west: 123.35,
    east: 123.93
  })
});


/* =========================================================
   ALBAY LOCATION POOL

   weight:
   Higher values make the area more likely to be selected.

   urbanRadiusM:
   Approximate sentro / built-up search radius.

   maxRadiusM:
   Maximum range used for occasional outskirts/rural rounds.
========================================================= */

const DROP_AREAS = Object.freeze([
  {
    name: "Legazpi",
    center: { lat: 13.1391, lng: 123.7438 },
    urbanRadiusM: 2300,
    maxRadiusM: 6500,
    weight: 6.0
  },
  {
    name: "Daraga",
    center: { lat: 13.1483, lng: 123.7124 },
    urbanRadiusM: 2100,
    maxRadiusM: 6000,
    weight: 5.0
  },
  {
    name: "Tabaco",
    center: { lat: 13.3586, lng: 123.7336 },
    urbanRadiusM: 2100,
    maxRadiusM: 6500,
    weight: 4.3
  },
  {
    name: "Ligao",
    center: { lat: 13.2403, lng: 123.5384 },
    urbanRadiusM: 1800,
    maxRadiusM: 6500,
    weight: 3.5
  },
  {
    name: "Polangui",
    center: { lat: 13.2923, lng: 123.4853 },
    urbanRadiusM: 1800,
    maxRadiusM: 6500,
    weight: 3.5
  },
  {
    name: "Guinobatan",
    center: { lat: 13.1913, lng: 123.5987 },
    urbanRadiusM: 1800,
    maxRadiusM: 6500,
    weight: 3.3
  },
  {
    name: "Camalig",
    center: { lat: 13.1820, lng: 123.6543 },
    urbanRadiusM: 1600,
    maxRadiusM: 5500,
    weight: 3.0
  },
  {
    name: "Oas",
    center: { lat: 13.2576, lng: 123.4953 },
    urbanRadiusM: 1600,
    maxRadiusM: 6500,
    weight: 2.8
  },
  {
    name: "Bacacay",
    center: { lat: 13.2934, lng: 123.7914 },
    urbanRadiusM: 1700,
    maxRadiusM: 7000,
    weight: 2.8
  },
  {
    name: "Santo Domingo",
    center: { lat: 13.2350, lng: 123.7770 },
    urbanRadiusM: 1400,
    maxRadiusM: 5500,
    weight: 2.1
  },
  {
    name: "Malilipot",
    center: { lat: 13.3189, lng: 123.7380 },
    urbanRadiusM: 1400,
    maxRadiusM: 5500,
    weight: 2.0
  },
  {
    name: "Malinao",
    center: { lat: 13.3990, lng: 123.7060 },
    urbanRadiusM: 1400,
    maxRadiusM: 6000,
    weight: 1.9
  },
  {
    name: "Tiwi",
    center: { lat: 13.4587, lng: 123.6803 },
    urbanRadiusM: 1500,
    maxRadiusM: 6500,
    weight: 1.9
  },
  {
    name: "Libon",
    center: { lat: 13.2990, lng: 123.4380 },
    urbanRadiusM: 1600,
    maxRadiusM: 7000,
    weight: 1.8
  },
  {
    name: "Pio Duran",
    center: { lat: 13.0300, lng: 123.4440 },
    urbanRadiusM: 1400,
    maxRadiusM: 7000,
    weight: 1.3
  },
  {
    name: "Jovellar",
    center: { lat: 13.0690, lng: 123.5990 },
    urbanRadiusM: 1200,
    maxRadiusM: 6000,
    weight: 1.1
  },
  {
    name: "Manito",
    center: { lat: 13.1230, lng: 123.8690 },
    urbanRadiusM: 1300,
    maxRadiusM: 6000,
    weight: 1.1
  }
]);


/* =========================================================
   GAME
========================================================= */

class AlbayGeoGuessr {
  constructor() {
    this.map = null;
    this.resultMap = null;
    this.panorama = null;
    this.streetViewService = null;

    this.guessMarker = null;
    this.resultGuessMarker = null;
    this.resultActualMarker = null;
    this.resultLine = null;

    this.state = this.createInitialState();
    this.elements = {};
  }

  /* COMPASS */
  updateCompass() {
  if (!this.panorama) {
    return;
  }

  const pov =
    this.panorama.getPov();

  if (!pov) {
    return;
  }

  const compassNeedle =
    document.getElementById(
      "compassNeedle"
    );

  if (!compassNeedle) {
    return;
  }

  compassNeedle.style.transform =
    `rotate(${-pov.heading}deg)`;
}

  createInitialState() {
    return {
      round: 1,
      totalScore: 0,

      currentLocation: null,
      currentPanoId: null,
      currentAreaName: null,

      roundReady: false,
      guessSubmitted: false,

      usedAreaNames: new Set(),
      usedPanoIds: new Set(),
      usedLocations: []
    };
  }


  init() {
    this.cacheElements();
    this.createMaps();
    this.bindEvents();
    this.startRound();
  }


  cacheElements() {
    this.elements.round = document.getElementById("roundDisplay");
    this.elements.score = document.getElementById("scoreDisplay");
    this.elements.message = document.getElementById("message");

    this.elements.guessButton = document.getElementById("guessBtn");
    this.elements.guessPanel = document.getElementById("guessPanel");

    this.elements.resultOverlay = document.getElementById("resultOverlay");
    this.elements.resultDistance = document.getElementById("resultDistance");
    this.elements.resultScore = document.getElementById("resultScore");
    this.elements.totalScore = document.getElementById("resultTotalScore");
    this.elements.nextButton = document.getElementById("nextBtn");

    this.elements.finalOverlay = document.getElementById("finalOverlay");
    this.elements.finalScore = document.getElementById("finalScore");
    this.elements.playAgainButton = document.getElementById("playAgainBtn");
  }


  createMaps() {
    const mapOptions = {
      center: CONFIG.mapCenter,
      zoom: CONFIG.mapZoom,
      mapTypeId: "roadmap",
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      gestureHandling: "greedy",
      clickableIcons: false
    };

    this.map = new google.maps.Map(
      document.getElementById("map"),
      mapOptions
    );

    this.resultMap = new google.maps.Map(
      document.getElementById("resultMap"),
      {
        ...mapOptions,

        // Fully interactive after guessing.
        gestureHandling: "greedy",
        scrollwheel: true,
        zoomControl: true,
        keyboardShortcuts: true,

        // Keep unnecessary controls hidden.
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false
      }
    );


    this.streetViewService = new google.maps.StreetViewService();
  }


  bindEvents() {
    this.map.addListener("click", (event) => {
      this.placeGuess(event.latLng);
    });

    this.elements.guessButton.addEventListener("click", () => {
      this.submitGuess();
    });

    this.elements.nextButton.addEventListener("click", () => {
      this.advanceRound();
    });

    this.elements.playAgainButton.addEventListener("click", () => {
      this.restartGame();
    });
  }


  /* =====================================================
     ROUND LIFECYCLE
  ===================================================== */

  async startRound() {
    this.resetRoundState();
    this.updateHud();

    this.setMessage("Finding a Street View location…");

    try {
      const roundLocation = await this.findRoundLocation();

      this.acceptRoundLocation(roundLocation);
      this.loadPanorama(roundLocation.location);

      this.state.roundReady = true;

      this.setMessage(
        "Look around, then place your guess on the map."
      );
    } catch (error) {
      console.error(error);

      this.setMessage(
        "Could not find a suitable Street View location. Retrying…"
      );

      window.setTimeout(() => {
        this.startRound();
      }, 900);
    }
  }


  resetRoundState() {
    this.state.currentLocation = null;
    this.state.currentPanoId = null;
    this.state.currentAreaName = null;
    this.state.roundReady = false;
    this.state.guessSubmitted = false;

    this.clearGuessMarker();
    this.clearResultMap();

    this.map.setCenter(CONFIG.mapCenter);
    this.map.setZoom(CONFIG.mapZoom);

    this.elements.guessButton.disabled = true;

    this.elements.guessPanel.classList.remove("is-hidden");
    this.elements.resultOverlay.classList.add("is-hidden");
    this.elements.finalOverlay.classList.add("is-hidden");
  }


  /* =====================================================
     LOCATION GENERATION

     Weighted area -> zone -> random seed -> nearest valid
     official outdoor Street View -> quality checks.
  ===================================================== */

  async findRoundLocation() {
    const temporarilyRejectedAreas = new Set();

    for (
      let areaAttempt = 0;
      areaAttempt < CONFIG.maxAreaAttempts;
      areaAttempt += 1
    ) {
      const area = this.chooseWeightedArea(temporarilyRejectedAreas);

      if (!area) {
        break;
      }

      for (
        let seedAttempt = 0;
        seedAttempt < CONFIG.seedAttemptsPerArea;
        seedAttempt += 1
      ) {
        const seed = this.generateSeed(area);
        const panoramaData = await this.lookupPanorama(seed.point);

        if (
          !panoramaData ||
          !panoramaData.location ||
          !panoramaData.location.latLng
        ) {
          continue;
        }

        const location = panoramaData.location.latLng;
        const panoId = panoramaData.location.pano || null;

        if (!this.isInsideAlbay(location)) {
          continue;
        }

        if (!this.isCloseEnoughToSeed(seed.point, location)) {
          continue;
        }

        if (panoId && this.state.usedPanoIds.has(panoId)) {
          continue;
        }

        if (this.isTooCloseToPreviousRound(location)) {
          continue;
        }

        return {
          location,
          panoId,
          areaName: area.name,
          zone: seed.zone
        };
      }

      temporarilyRejectedAreas.add(area.name);
    }

    throw new Error(
      "No acceptable Street View panorama found within the search budget."
    );
  }


  chooseWeightedArea(extraExcludedNames = new Set()) {
    let candidates = DROP_AREAS.filter(
      (area) =>
        !this.state.usedAreaNames.has(area.name) &&
        !extraExcludedNames.has(area.name)
    );

    if (candidates.length === 0) {
      candidates = DROP_AREAS.filter(
        (area) => !extraExcludedNames.has(area.name)
      );
    }

    if (candidates.length === 0) {
      return null;
    }

    const totalWeight = candidates.reduce(
      (sum, area) => sum + area.weight,
      0
    );

    let cursor = Math.random() * totalWeight;

    for (const area of candidates) {
      cursor -= area.weight;

      if (cursor <= 0) {
        return area;
      }
    }

    return candidates[candidates.length - 1];
  }


  generateSeed(area) {
    const roll = Math.random();

    const {
      urban,
      outskirts
    } = CONFIG.locationMix;

    let zone;
    let minDistanceM;
    let maxDistanceM;

    if (roll < urban) {
      zone = "urban";
      minDistanceM = 0;
      maxDistanceM = area.urbanRadiusM;
    } else if (roll < urban + outskirts) {
      zone = "outskirts";
      minDistanceM = area.urbanRadiusM * 0.75;
      maxDistanceM = area.maxRadiusM * 0.68;
    } else {
      zone = "rural";
      minDistanceM = area.maxRadiusM * 0.58;
      maxDistanceM = area.maxRadiusM;
    }

    return {
      zone,
      point: this.randomPointInRing(
        area.center,
        minDistanceM,
        maxDistanceM
      )
    };
  }


  randomPointInRing(center, minDistanceM, maxDistanceM) {
    const minSq = minDistanceM ** 2;
    const maxSq = maxDistanceM ** 2;

    const distanceM = Math.sqrt(
      minSq +
      Math.random() *
      (maxSq - minSq)
    );

    const bearing = Math.random() * Math.PI * 2;

    const latitudeOffset =
      (distanceM * Math.cos(bearing)) /
      111320;

    const longitudeScale =
      111320 *
      Math.cos(
        center.lat *
        Math.PI /
        180
      );

    const longitudeOffset =
      (distanceM * Math.sin(bearing)) /
      longitudeScale;

    return {
      lat: center.lat + latitudeOffset,
      lng: center.lng + longitudeOffset
    };
  }


  lookupPanorama(point) {
    return new Promise((resolve) => {
      this.streetViewService.getPanorama(
        {
          location: point,
          radius: CONFIG.panoramaSearchRadiusM,

          preference:
            google.maps.StreetViewPreference.NEAREST,

          /*
            Request official Google, outdoor Street View.
            This avoids random user PhotoSpheres and indoor imagery.
          */
          sources: [
            google.maps.StreetViewSource.GOOGLE,
            google.maps.StreetViewSource.OUTDOOR
          ]
        },

        (data, status) => {
          if (
            status ===
            google.maps.StreetViewStatus.OK
          ) {
            resolve(data);
          } else {
            resolve(null);
          }
        }
      );
    });
  }


  isCloseEnoughToSeed(seed, panoramaLocation) {
    const seedLatLng = new google.maps.LatLng(
      seed.lat,
      seed.lng
    );

    const distance =
      google.maps.geometry.spherical.computeDistanceBetween(
        seedLatLng,
        panoramaLocation
      );

    return distance <= CONFIG.panoramaSnapLimitM;
  }


  isInsideAlbay(location) {
    const lat = location.lat();
    const lng = location.lng();
    const bounds = CONFIG.albayBounds;

    return (
      lat >= bounds.south &&
      lat <= bounds.north &&
      lng >= bounds.west &&
      lng <= bounds.east
    );
  }


  isTooCloseToPreviousRound(location) {
    return this.state.usedLocations.some(
      (previousLocation) => {
        const distance =
          google.maps.geometry.spherical.computeDistanceBetween(
            location,
            previousLocation
          );

        return distance < CONFIG.minRoundSeparationM;
      }
    );
  }


  acceptRoundLocation(roundLocation) {
    this.state.currentLocation = roundLocation.location;
    this.state.currentPanoId = roundLocation.panoId;
    this.state.currentAreaName = roundLocation.areaName;

    this.state.usedAreaNames.add(roundLocation.areaName);
    this.state.usedLocations.push(roundLocation.location);

    if (roundLocation.panoId) {
      this.state.usedPanoIds.add(roundLocation.panoId);
    }
  }


  /* =====================================================
     STREET VIEW
  ===================================================== */

  loadPanorama(position) {
  const heading = Math.random() * 360;

  if (!this.panorama) {
    this.panorama = new google.maps.StreetViewPanorama(
      document.getElementById("street-view"),
      {
        position,

        pov: {
          heading,
          pitch: 0
        },

        zoom: 1,

        addressControl: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
        showRoadLabels: false,

        linksControl: true,
        panControl: false,
        zoomControl: true,
        enableCloseButton: false,
        clickToGo: true,
        visible: true
      }
    );

    this.panorama.addListener(
      "pov_changed",
      () => {
        this.updateCompass();
      }
    );

    this.updateCompass();

    return;
  }

  this.panorama.setPosition(position);

  this.panorama.setPov({
    heading,
    pitch: 0
  });

  this.panorama.setZoom(1);
  this.panorama.setVisible(true);

  this.updateCompass();
}

  /* =====================================================
     GUESSING
  ===================================================== */

  placeGuess(position) {
    if (
      !this.state.roundReady ||
      this.state.guessSubmitted
    ) {
      return;
    }

    if (!this.guessMarker) {
      this.guessMarker = new google.maps.Marker({
        map: this.map,
        position,
        title: "Your guess",
        label: "G"
      });
    } else {
      this.guessMarker.setPosition(position);
    }

    this.elements.guessButton.disabled = false;
  }


  submitGuess() {
    if (
      !this.state.roundReady ||
      this.state.guessSubmitted ||
      !this.guessMarker ||
      !this.state.currentLocation
    ) {
      return;
    }

    // Lock scoring immediately so a double-click cannot award points twice.
    this.state.guessSubmitted = true;
    this.elements.guessButton.disabled = true;

    const guessPosition = this.guessMarker.getPosition();

    const distanceM =
      google.maps.geometry.spherical.computeDistanceBetween(
        guessPosition,
        this.state.currentLocation
      );

    const distanceKm = distanceM / 1000;
    const roundScore = this.calculateScore(distanceKm);

    this.state.totalScore += roundScore;

    this.showRoundResult(
      guessPosition,
      distanceKm,
      roundScore
    );

    this.updateHud();
  }


  calculateScore(distanceKm) {
    const score =
      CONFIG.maxRoundScore *
      Math.exp(
        -distanceKm /
        CONFIG.scoreDecayKm
      );

    return Math.max(
      0,
      Math.min(
        CONFIG.maxRoundScore,
        Math.round(score)
      )
    );
  }


  /* =====================================================
     ROUND RESULT

     The result card floats above Street View.
     Everything outside the card remains interactive, so
     the player can continue roaming after submitting.
  ===================================================== */

  showRoundResult(
    guessPosition,
    distanceKm,
    roundScore
  ) {
    this.elements.guessPanel.classList.add("is-hidden");

    this.elements.resultOverlay.classList.remove("is-hidden");

    // Explicitly keep the panorama visible and interactive after guessing.
    if (this.panorama) {
      this.panorama.setVisible(true);
    }

    this.elements.resultDistance.textContent =
      `${distanceKm.toFixed(2)} km`;

    this.elements.resultScore.textContent =
      `${roundScore.toLocaleString()} pts`;

    this.elements.totalScore.textContent =
      `${this.state.totalScore.toLocaleString()} / ${(
        CONFIG.maxRoundScore *
        CONFIG.roundsPerGame
      ).toLocaleString()}`;

    this.elements.nextButton.textContent =
      this.state.round === CONFIG.roundsPerGame
        ? "View Final Score"
        : "Next Round";

    /*
      The result map starts hidden.
      Trigger a resize before fitting the two markers.
    */
    window.setTimeout(() => {
      google.maps.event.trigger(
        this.resultMap,
        "resize"
      );

      this.drawResultMap(
        guessPosition,
        this.state.currentLocation
      );
    }, 0);

    this.setMessage(
      "Answer revealed — you can keep exploring Street View before continuing."
    );
  }


  drawResultMap(
    guessPosition,
    actualPosition
  ) {
    this.clearResultMap();

    this.resultGuessMarker = new google.maps.Marker({
      map: this.resultMap,
      position: guessPosition,
      label: "G",
      title: "Your guess"
    });

    this.resultActualMarker = new google.maps.Marker({
      map: this.resultMap,
      position: actualPosition,
      label: "A",
      title: "Actual location"
    });

    this.resultLine = new google.maps.Polyline({
      map: this.resultMap,

      path: [
        guessPosition,
        actualPosition
      ],

      geodesic: true,
      strokeOpacity: 0.85,
      strokeWeight: 4
    });

    const bounds =
      new google.maps.LatLngBounds();

    bounds.extend(guessPosition);
    bounds.extend(actualPosition);

    this.resultMap.fitBounds(
      bounds,
      70
    );
  }


  clearResultMap() {
    if (this.resultGuessMarker) {
      this.resultGuessMarker.setMap(null);
      this.resultGuessMarker = null;
    }

    if (this.resultActualMarker) {
      this.resultActualMarker.setMap(null);
      this.resultActualMarker = null;
    }

    if (this.resultLine) {
      this.resultLine.setMap(null);
      this.resultLine = null;
    }
  }


  clearGuessMarker() {
    if (!this.guessMarker) {
      return;
    }

    this.guessMarker.setMap(null);
    this.guessMarker = null;
  }


  /* =====================================================
     GAME PROGRESSION
  ===================================================== */

  advanceRound() {
    if (!this.state.guessSubmitted) {
      return;
    }

    if (
      this.state.round >=
      CONFIG.roundsPerGame
    ) {
      this.showFinalScore();
      return;
    }

    this.state.round += 1;
    this.startRound();
  }


  showFinalScore() {
    const maximum =
      CONFIG.maxRoundScore *
      CONFIG.roundsPerGame;

    this.elements.resultOverlay.classList.add("is-hidden");
    this.elements.finalOverlay.classList.remove("is-hidden");

    this.elements.finalScore.textContent =
      `${this.state.totalScore.toLocaleString()} / ${maximum.toLocaleString()}`;

    this.setMessage("Game complete.");
  }


  restartGame() {
    this.state = this.createInitialState();
    this.startRound();
  }


  updateHud() {
    this.elements.round.textContent =
      `Round ${this.state.round} / ${CONFIG.roundsPerGame}`;

    this.elements.score.textContent =
      `${this.state.totalScore.toLocaleString()} pts`;
  }


  setMessage(message) {
    this.elements.message.textContent = message;
  }
}


/* =========================================================
   APPLICATION
========================================================= */

let game = null;

window.initGame = function initGame() {
  game = new GeoGuessr();
  game.init();
};

window.gm_authFailure = function gmAuthFailure() {
  const message =
    document.getElementById("message");

  if (message) {
    message.textContent =
      "Google Maps authentication failed. Check the API key, restrictions, enabled APIs, and billing.";
  }
};