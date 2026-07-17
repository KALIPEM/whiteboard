const getPolygonPoints = (sides, width, height) => {
  const points = [];
  const radiusX = Math.abs(width) / 2;
  const radiusY = Math.abs(height) / 2;
  const cx = width / 2;
  const cy = height / 2;
  for (let i = 0; i < sides; i++) {
    // Math.PI / 2 offset to point up
    const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
    points.push(cx + radiusX * Math.cos(angle));
    points.push(cy + radiusY * Math.sin(angle));
  }
  return points;
}
console.log(getPolygonPoints(3, 100, 100));
console.log(getPolygonPoints(4, 100, 100));
