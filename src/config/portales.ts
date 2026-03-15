import { PortalConfig } from '../types';

// Configuración de portales de noticias argentinos para scraping
// Selectores verificados contra HTML real de cada portal
export const PORTALES: PortalConfig[] = [
  {
    nombre: 'La Nación - Seguridad',
    url: 'https://www.lanacion.com.ar/seguridad/',
    baseUrl: 'https://www.lanacion.com.ar',
    selectores: {
      listado: 'article.mod-article',
      titulo: 'h2.com-title a.com-link',
      contenido: 'p.com-paragraph',   // selector dentro de la nota individual
      fecha: 'time.com-date',
      link: 'h2.com-title a.com-link',
    },
  },
  {
    nombre: 'Crónica - Policiales',
    url: 'https://www.cronica.com.ar/policiales/',
    baseUrl: 'https://www.cronica.com.ar',
    selectores: {
      listado: 'article.item.news',
      titulo: 'h2.title',
      contenido: '.article-body p',
      fecha: '.datetime .date',
      link: 'a.link',
    },
  },
  {
    nombre: 'Infobae - Policiales',
    url: 'https://www.infobae.com/sociedad/policiales/',
    baseUrl: 'https://www.infobae.com',
    selectores: {
      listado: 'a.feed-list-card',
      titulo: 'h2.feed-list-card-headline-lean',
      contenido: '.article-body p, [data-component="Article"] p',
      link: 'a.feed-list-card',
    },
  },
  {
    nombre: 'TN - Policiales',
    url: 'https://tn.com.ar/policiales/',
    baseUrl: 'https://tn.com.ar',
    selectores: {
      listado: 'article.card__container',
      titulo: 'h2.card__headline a',
      contenido: '.article__body p, .content__body p',
      link: 'h2.card__headline a',
    },
  },
  {
    nombre: 'Clarín - Policiales',
    url: 'https://www.clarin.com/policiales/',
    baseUrl: 'https://www.clarin.com',
    selectores: {
      listado: 'article',
      titulo: 'h2.title',
      contenido: '.body-nota p, article p',
      fecha: 'span.date',
      link: 'a[href*="/policiales/"]',
    },
  },
];
