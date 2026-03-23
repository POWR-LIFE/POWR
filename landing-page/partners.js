    // Initialize the Discover Mockup Map
    function initDiscoverMap() {
      const mapEl = document.getElementById('discoverMockupMap');
      const centerCoords = [51.5238, -0.1415];
      const tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      
      const mockupMap = L.map(mapEl, {
        center: centerCoords,
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        touchZoom: false
      });

      L.tileLayer(tileUrl).addTo(mockupMap);

      // Navigation Path (from Third Space to User)
      const pathCoords = [
        [51.5242, -0.1450], // Start at Third Space
        [51.5235, -0.1435],
        [51.5228, -0.1415],
        [51.5219, -0.1387]  // End at Blue Dot
      ];

      // Glow effect layer
      L.polyline(pathCoords, {
        color: '#E8D200',
        weight: 12,
        opacity: 0.15,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(mockupMap);

      // Dotted primary path
      L.polyline(pathCoords, {
        color: '#E8D200',
        weight: 6,
        dashArray: '1, 15',
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(mockupMap);

      // Trigger redraw
      setTimeout(() => { mockupMap.invalidateSize(); }, 300);
    }
    initDiscoverMap();

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.08 });
  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
