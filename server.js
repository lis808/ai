const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'projects.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readProjects() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function writeProjects(projects) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(projects, null, 2));
}

app.get('/api/projects', (req, res) => {
  res.json(readProjects());
});

app.post('/api/projects', (req, res) => {
  const projects = readProjects();
  const { title, description, image } = req.body;
  const newProject = { id: uuidv4(), title, description, image };
  projects.push(newProject);
  writeProjects(projects);
  res.json(newProject);
});

app.put('/api/projects/:id', (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  project.title = req.body.title;
  project.description = req.body.description;
  project.image = req.body.image;
  writeProjects(projects);
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  let projects = readProjects();
  const index = projects.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  const removed = projects.splice(index, 1)[0];
  writeProjects(projects);
  res.json(removed);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
