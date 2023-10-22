# MLH/mlh-hackathon-repetitivo

Este es un modelo estándar de hackathon creado por [Major League Hacking][mlh-github]. Al usar [Jekyll][jekyll], tiene una [configuración][config] extensible que cubre información básica de eventos. Luego puede bifurcar el sitio web y alojarlo de forma gratuita a través de [GitHub Pages][github-pages]. Es de uso gratuito.

Ventajas:

- Soporte integrado para [MyMLH][my-mlh]
- Propiedad y mantenimiento de la comunidad
- Alojamiento gratuito a través de [Páginas de GitHub][páginas de github]
- Descubrible a través de la Búsqueda de Google, Twitter y Facebook

[mlh-github]: https://github.com/MLH
[jekyll]: https://jekyllrb.com
[configuración]: _config.yml
[páginas de github]: https://pages.github.com
[mi-mlh]: https://my.mlh.io

## Empezando

1. Cree una cuenta [GitHub][create-account] si aún no lo has hecho
2. Bifurque este repositorio en su propia cuenta. [Haga clic aquí para bifurcar este repositorio][fork-repo]
3. Edite [`_config.yml`][config] para configurar su propio sitio web de hackathon
4. Eso es todo: deberías poder acceder en `https://[nombre de usuario de github].github.io/mlh-hackathon-boilerplate/`

[crear cuenta]: https://github.com/join
[repo-tenedor]: https://github.com/MLH/mlh-hackathon-boilerplate/fork

### Ejecutar localmente

Si desea completar y probar el sitio web localmente, siga estos pasos:

1. Instale los requisitos previos de Jekyll siguiendo una de las [guías][jekyll-guides]
2. Instale Jekyll y Bundler Gems `Gem Install Jekyll Bundler`
3. Cree y proporcione el sitio localmente "bundle exec jekyllserve"
4. Dirígete a [http://localhost:4000/][localhost]
5.Asegúrate de que todo luzca bien

[guías-jekyll]: https://jekyllrb.com/docs/installation/
[localhost]: http://localhost:4000/

### Configurar un dominio personalizado

¿Quiere configurar su propio dominio personalizado? ¡Excelente! A través de nuestros excelentes socios [Domain.com][domain-com], Major League Hacking ofrece dominios gratuitos a los organizadores de hackathon estudiantiles. Comuníquese con [hi@mlh.io][email-mlh] para obtener su código de cupón gratuito.

1. Registra tu dominio
2. Actualice el dominio `www` a `CNAME [nombre de usuario de github].github.io`
3. Actualice el dominio `@` a `A 192.30.252.153` y `A 192.30.252.154`
4. Actualice el `CNAME` en su bifurcación de GitHub de `mlh-hackathon-boilerplate` a su nuevo dominio (es decir, `examplehacks.com`)

[Referencia: GitHub - Configuración de un dominio apex][github-apex-domain]

[dominio-com]: https://dominio.com/mlh
[correo electrónico-mlh]: mailto:hi@mlh.io
[dominio-apex-github]: https://help.github.com/articles/setting-up-an-apex-domain/

### Configurar SSL

GitHub Pages ahora le ofrece una opción para aplicar HTTPS que creará un certificado SSL para usted. Todo lo que necesita es seleccionar la marca de verificación Aplicar HTTPS al configurar un dominio personalizado en el paso anterior.

Espere algo de tiempo al proceso, pero si no se completa después de varios minutos, haga clic en **Eliminar** junto a su nombre de dominio, vuelva a escribir el nombre de dominio y luego haga clic en **Guardar**. Esto reiniciará el proceso de emisión de SSL.

Si configura HTTPS correctamente, asegúrese de no hacer referencia a HTTP en ninguna parte de su sitio web. Servir contenido [mixto][mixto] hará que su sitio web sea menos seguro.

[mixto]: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https#resolving-problems-with-mixed- contenido

## Contribuyendo

Nuestro texto estándar está escrito completamente en [Jekyll][jekyll], que GitHub compila automáticamente. Esto reduce drásticamente la barrera técnica necesaria para configurar un sitio web de hackathon. Nos encantaría recibir sus contribuciones para hacer esto aún mejor. Un par de cosas a anotar:

- No podemos aceptar complementos personalizados porque no son compatibles con [GitHub Pages][github-pages]
- Si agrega imágenes o componentes externos, asegúrese de tener el permiso correcto para usarlos
- Recomendamos crear primero una incidencia en GitHub explicando la incidencia.
