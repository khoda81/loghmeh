import { mount } from 'svelte';
import Planner from './planner/Planner.svelte';

// Week navigation owns the calendar position.
history.scrollRestoration = 'manual';
mount(Planner, { target: document.body });
