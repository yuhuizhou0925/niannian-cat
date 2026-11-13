import { loadCatModel } from '../renderer/cat';

loadCatModel().then(() => import('./studio'));
