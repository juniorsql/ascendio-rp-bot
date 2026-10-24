# Aceite com Discord e FadeHost reais

Execute esta lista depois de configurar as contas. Estes itens **não foram testados contra os serviços reais na entrega**, pois não havia credenciais configuradas.

1. Confirme Node >=24.17.0, `DATA_DIR=/data/ascendio`, Server Members Intent e permissões do bot nos canais.
2. Faça deploy e confira `bot_online` e `commands_registered` sem erros posteriores. Execute `/ajuda` no servidor correto.
3. Configure recepção e regras. Faça uma conta humana de teste entrar no servidor; confira a menção individual, nome, orientação e rodapé. Nenhuma recepção deve ser publicada por entrada de outro bot.
4. Crie `/anuncio` e confira que o formulário e a prévia são privados. Teste texto Markdown, campos, imagem e miniatura públicos. Mude a cor, edite o conteúdo e confirme. Verifique o canal e o link retornado.
5. Crie outra prévia e cancele. Nenhuma mensagem pública deve aparecer.
6. Confirme rapidamente duas vezes. Deve existir uma só publicação. Tente o mesmo conteúdo no mesmo canal em menos de dez minutos; a duplicata deve ser bloqueada.
7. Como usuário comum, tente os comandos administrativos. Eles devem ficar indisponíveis ou recusar o acesso. Teste também um publicador por cargo após configurar a permissão em Integrações.
8. Remova o cargo/permissão de um autor entre a prévia e a confirmação. A publicação deve ser recusada. O cargo de publicador não deve editar `/configurar`.
9. Remova Inserir links do bot no canal de teste. A confirmação deve falhar com orientação e sem publicação; restaure a permissão.
10. Com a opção de notificação desligada, tente digitar `@everyone`, `@here`, menção a cargo e usuário no anúncio. Não deve haver notificação dessas menções. Confira **Ativar @everyone**, o aviso na prévia e a opção de desativar. Sem Mencionar todos para o autor ou para o bot, a ativação e o envio devem ser recusados. Para homologar a notificação real, confirme em um canal de teste com participantes avisados pela equipe; não use anúncios reais como teste. Tente URL HTTP/local e conteúdo que ultrapasse o total de 6.000 caracteres com campos; deve haver rejeição privada.
11. Confira `/regras` com as oito categorias demonstrativas. Edite uma, marque-a oficial e verifique que somente a marcação daquela categoria mudou. Revise antes de publicar.
12. Configure um canal privado de logs. Confira os registros de configuração, cancelamento no histórico e publicação. Exporte a configuração e confira que não contém token.
13. Aguarde a expiração de uma prévia. O botão deve informar expiração; recrie-a para publicar.
14. Reinicie e faça um novo deploy. As configurações e os recibos devem permanecer; rascunhos devem expirar. Verifique que os dados estão fora do checkout.
15. Desligue o computador e teste pelo celular. Acompanhe memória e tráfego sob uso real. Verifique também os e-mails da FadeHost sobre manutenção da atividade do plano.

Anote a data, o responsável, IDs de mensagens de teste e resultado de cada item. Só declare o aceite operacional concluído quando todos os itens necessários passarem.
