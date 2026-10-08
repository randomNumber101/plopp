// Leaflet global bereitstellen, bevor Plugins (markercluster) geladen werden
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

;(window as unknown as { L: typeof L }).L = L

export default L
