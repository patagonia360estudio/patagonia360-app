let map, marker;

function startGPS() {
  if (!navigator.geolocation) {
    alert("GPS no soportado");
    return;
  }

  navigator.geolocation.watchPosition(pos => {

    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    if (!map) {
      map = L.map('map').setView([lat, lon], 15);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

      marker = L.marker([lat, lon]).addTo(map);
    } else {
      marker.setLatLng([lat, lon]);
      map.setView([lat, lon]);
    }

    updateArrow(lat, lon);

  }, err => {
    console.log(err);
  }, {
    enableHighAccuracy:true
  });
}

/* 🔥 Flecha dinámica */
function updateArrow(lat, lon) {

  const targetLat = -41.133;
  const targetLon = -71.310;

  const dLon = targetLon - lon;

  const y = Math.sin(dLon) * Math.cos(targetLat);
  const x = Math.cos(lat) * Math.sin(targetLat) -
            Math.sin(lat) * Math.cos(targetLat) * Math.cos(dLon);

  let brng = Math.atan2(y, x);
  brng = brng * 180 / Math.PI;

  document.getElementById("arrow").style.transform =
    `translate(-50%, -50%) rotate(${brng}deg)`;
}
