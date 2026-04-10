import Knex from 'knex';
import knexConfig from '../../knexfile';
import { config } from '../config';

const env = config.env as keyof typeof knexConfig;
const activeConfig = knexConfig[env] ?? knexConfig['development'];

export const db = Knex(activeConfig);
