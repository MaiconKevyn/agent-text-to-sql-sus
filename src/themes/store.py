"""Armazenamento dos temas: um arquivo JSON por tema.

No SERVIDOR, e não no navegador, por três razões nesta ordem:

  1. O chat do tema precisa dos blocos no prompt. Com armazenamento no cliente,
     o frontend teria de subir todos os blocos a cada pergunta — e um bloco
     carrega até 200 linhas de tabela. Aqui a API lê o tema por id e monta o
     contexto no lugar onde ele é usado.
  2. O tema sobrevive a limpar o navegador. Uma investigação de semanas não
     pode morrer num "limpar dados de navegação".
  3. Vira compartilhável por URL sem nenhum trabalho a mais.

Arquivo JSON e não banco: um tema é um documento, sempre lido e escrito inteiro,
e nunca serão milhares. SQLite aqui seria cerimônia sem benefício.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from datetime import datetime, timezone

from ..config import settings
from ..storage import DocumentoInexistente, Documentos
from .models import (
    ALTURA_MAX,
    ALTURA_MIN,
    Bloco,
    COLUNAS,
    Definicao,
    Fio,
    LARGURA_MIN,
    Pergunta,
    PAPEIS,
    PESOS,
    Tema,
)


class TemaInexistente(DocumentoInexistente):
    pass


class Armazem:
    """Temas em disco, um arquivo por tema.

    A escrita é atômica (arquivo temporário e `os.replace`) porque um tema é
    reescrito inteiro a cada bloco fixado: uma interrupção no meio de um
    `write` deixaria o arquivo truncado e a investigação perdida.
    """

    def __init__(self, raiz: str | Path | None = None):
        self._docs: Documentos[Tema] = Documentos(
            raiz or getattr(settings, "themes_dir", "data/temas"),
            prefixo="tema",
            de_json=Tema.de_json,
            para_json=lambda t: t.para_json(),
            id_de=lambda t: t.id,
            chave_ordem=lambda t: t.atualizado_em,
        )

    def ler(self, id_: str) -> Tema:
        try:
            return self._docs.ler(id_)
        except DocumentoInexistente as e:
            raise TemaInexistente(id_) from e

    def listar(self) -> list[Tema]:
        """Todos os temas, do mais recente para o mais antigo.

        Devolve os objetos completos; quem chama decide se serializa com ou sem
        blocos. A lista da interface usa `com_blocos=False`.
        """
        return self._docs.listar()

    def salvar(self, tema: Tema) -> Tema:
        tema.toca()
        return self._docs.salvar(tema)

    def criar(self, titulo: str = "", descricao: str = "") -> Tema:
        tema = Tema(titulo=titulo.strip() or "Nova investigação", descricao=descricao.strip())
        return self.salvar(tema)

    def apagar(self, id_: str) -> None:
        self._docs.apagar(id_)

    # -- operações sobre o conteúdo -----------------------------------------
    def fixar(self, id_: str, bloco: Bloco) -> Tema:
        tema = self.ler(id_)
        _sanear_fonte(bloco)
        tema.blocos.append(bloco)
        return self.salvar(tema)

    def desafixar(self, id_: str, bloco_id: str) -> Tema:
        tema = self.ler(id_)
        tema.blocos = [b for b in tema.blocos if b.id != bloco_id]
        return self.salvar(tema)

    def classificar(self, id_: str, bloco_id: str, mudanca: dict) -> Tema:
        """Papel, peso e "por que importa" de um achado.

        Só os três: quem edita a classificação não deveria conseguir, pelo mesmo
        caminho, mexer no SQL ou no resultado — eles são congelados, e é essa
        garantia que faz um número citado continuar citável.
        """
        tema = self.ler(id_)
        b = tema.bloco(bloco_id)
        if b is None:
            raise TemaInexistente(bloco_id)
        if "role" in mudanca and mudanca["role"] in PAPEIS:
            b.papel = mudanca["role"]
        if "weight" in mudanca and mudanca["weight"] in PESOS:
            b.peso = mudanca["weight"]
        if "why" in mudanca:
            b.porque = str(mudanca["why"] or "")[:400]
        # O fio entra pelo mesmo PATCH: mudar de fio é classificar, e separar
        # em duas rotas obrigaria a tela a fazer duas chamadas para o gesto de
        # "este achado sustenta a tendência" — que é uma coisa só.
        if "thread" in mudanca:
            alvo = str(mudanca["thread"] or "")
            b.fio_id = alvo if any(f.id == alvo for f in tema.fios) else ""
        return self.salvar(tema)

    def criar_fio(self, id_: str, titulo: str, resumo: str = "") -> Tema:
        tema = self.ler(id_)
        ordem = max((f.ordem for f in tema.fios), default=-1) + 1
        tema.fios.append(Fio(titulo=titulo.strip()[:80] or "Sem título", resumo=resumo.strip()[:200], ordem=ordem))
        return self.salvar(tema)

    def editar_fio(self, id_: str, fio_id: str, mudanca: dict) -> Tema:
        tema = self.ler(id_)
        f = next((x for x in tema.fios if x.id == fio_id), None)
        if f is None:
            raise TemaInexistente(fio_id)
        if "title" in mudanca:
            f.titulo = str(mudanca["title"] or "").strip()[:80] or f.titulo
        if "summary" in mudanca:
            f.resumo = str(mudanca["summary"] or "").strip()[:200]
        return self.salvar(tema)

    def apagar_fio(self, id_: str, fio_id: str) -> Tema:
        """Apaga o fio e SOLTA os achados dele — nunca os apaga junto.

        Um achado custou uma consulta ao banco e carrega a evidência congelada;
        um fio é só um agrupamento. Levar os dez achados junto porque alguém
        desfez a organização seria destruir o caro para desfazer o barato.
        """
        tema = self.ler(id_)
        tema.fios = [f for f in tema.fios if f.id != fio_id]
        for b in tema.blocos:
            if b.fio_id == fio_id:
                b.fio_id = ""
        return self.salvar(tema)

    def mover_para_fio(self, id_: str, bloco_id: str, fio_id: str) -> Tema:
        """Põe o achado num fio. Fio vazio ou inexistente devolve ao quadro solto."""
        tema = self.ler(id_)
        b = tema.bloco(bloco_id)
        if b is None:
            raise TemaInexistente(bloco_id)
        b.fio_id = fio_id if any(f.id == fio_id for f in tema.fios) else ""
        return self.salvar(tema)

    def criar_pergunta(self, id_: str, texto: str, fio_id: str = "") -> tuple[Tema, Pergunta]:
        tema = self.ler(id_)
        ordem = max((p.ordem for p in tema.perguntas), default=-1) + 1
        p = Pergunta(
            texto=texto.strip()[:300],
            fio_id=fio_id if any(f.id == fio_id for f in tema.fios) else "",
            ordem=ordem,
        )
        tema.perguntas.append(p)
        return self.salvar(tema), p

    def gravar_resposta(
        self, id_: str, pergunta_id: str, *, texto: str, citados: list[str], descartados: list[dict]
    ) -> Tema:
        """Guarda a resposta E o recorte que estava em vigor quando ela saiu.

        `definicoes_usadas` é o que torna possível dizer, depois, que a resposta
        envelheceu: numa base fechada o número não muda, mas a definição de
        "câncer" muda — e com ela o número muda por 3,6x sem nada na tela avisar.
        """
        tema = self.ler(id_)
        p = next((x for x in tema.perguntas if x.id == pergunta_id), None)
        if p is None:
            raise TemaInexistente(pergunta_id)
        validos = {b.id for b in tema.blocos}
        p.resposta = texto
        p.citados = [c for c in citados if c in validos]
        p.descartados = [d for d in descartados if d.get("bloco") in validos]
        p.respondida_em = _agora_iso()
        p.definicoes_usadas = tema.clausulas
        return self.salvar(tema)

    def apagar_pergunta(self, id_: str, pergunta_id: str) -> Tema:
        """Apaga a pergunta. Os achados que ela citava ficam — eles são do tema."""
        tema = self.ler(id_)
        tema.perguntas = [p for p in tema.perguntas if p.id != pergunta_id]
        return self.salvar(tema)

    def mover_pergunta(self, id_: str, pergunta_id: str, fio_id: str) -> Tema:
        tema = self.ler(id_)
        p = next((x for x in tema.perguntas if x.id == pergunta_id), None)
        if p is None:
            raise TemaInexistente(pergunta_id)
        p.fio_id = fio_id if any(f.id == fio_id for f in tema.fios) else ""
        return self.salvar(tema)

    def anotar(self, id_: str, bloco_id: str, anotacao: str) -> Tema:
        tema = self.ler(id_)
        bloco = tema.bloco(bloco_id)
        if bloco is None:
            raise TemaInexistente(bloco_id)
        bloco.anotacao = anotacao.strip()
        return self.salvar(tema)

    def formatar(
        self,
        id_: str,
        bloco_id: str,
        *,
        formato: str | None = None,
        largura: int | None = None,
        altura: int | None = None,
    ) -> Tema:
        """Ajusta a apresentação de um bloco no painel.

        Valor inválido é ignorado em silêncio e tamanho fora da faixa é
        aparado, em vez de virar erro: o pedido vem de um arrasto, e um pixel a
        mais na borda não é motivo para recusar a operação inteira.
        """
        tema = self.ler(id_)
        bloco = tema.bloco(bloco_id)
        if bloco is None:
            raise TemaInexistente(bloco_id)
        if formato in ("auto", "indicador", "grafico", "tabela", "citacao"):
            bloco.formato = formato  # type: ignore[assignment]
        if isinstance(largura, int):
            bloco.largura = max(LARGURA_MIN, min(COLUNAS, largura))
        if isinstance(altura, int):
            bloco.altura = max(ALTURA_MIN, min(ALTURA_MAX, altura))
        return self.salvar(tema)

    def dispor(self, id_: str, arranjo: list[dict]) -> Tema:
        """Grava a grade inteira de uma vez.

        Em lote e não bloco a bloco porque um único movimento reposiciona
        vários: quem estava na vaga desce, e quem ficou com buraco embaixo sobe.
        Gravar um por vez deixaria o disco passar por estados com blocos
        sobrepostos — e uma falha no meio congelaria o tema num deles.

        O que não vier no arranjo fica onde está; valor fora da faixa é aparado.
        """
        tema = self.ler(id_)
        por_id = {b.id: b for b in tema.blocos}
        for item in arranjo:
            bloco = por_id.get(str(item.get("id")))
            if bloco is None:
                continue
            bloco.largura = max(LARGURA_MIN, min(COLUNAS, int(item.get("width", bloco.largura))))
            bloco.altura = max(ALTURA_MIN, min(ALTURA_MAX, int(item.get("height", bloco.altura))))
            bloco.x = max(0, min(COLUNAS - bloco.largura, int(item.get("x", bloco.x))))
            bloco.y = max(0, int(item.get("y", bloco.y)))
        # A ordem da lista deixa de ser o arranjo, mas continua sendo a ordem de
        # leitura do relatório e do contexto do chat. Alinhar as duas evita que
        # o texto conte a investigação numa ordem e a tela mostre outra.
        tema.blocos.sort(key=lambda b: (b.y, b.x))
        return self.salvar(tema)

    def pintar(self, id_: str, paleta: str) -> Tema:
        """Fixa a paleta deste tema. Vazio devolve o tema à paleta do site."""
        tema = self.ler(id_)
        # Sem validar contra uma lista: os nomes vivem no frontend, e repeti-los
        # aqui criaria duas listas para manter em dia. Um id desconhecido cai no
        # padrão na hora de aplicar, que é o comportamento certo de qualquer
        # forma.
        tema.paleta = paleta.strip()[:40]
        return self.salvar(tema)

    def reordenar(self, id_: str, ordem: list[str]) -> Tema:
        """Reordena pelos ids recebidos; o que não vier na lista fica no fim."""
        tema = self.ler(id_)
        posicao = {bid: i for i, bid in enumerate(ordem)}
        tema.blocos.sort(key=lambda b: posicao.get(b.id, len(posicao)))
        return self.salvar(tema)

    def definir(self, id_: str, definicao: Definicao) -> Tema:
        """Acrescenta ou substitui a definição de um termo no tema."""
        tema = self.ler(id_)
        tema.definicoes = [d for d in tema.definicoes if d.termo.lower() != definicao.termo.lower()]
        tema.definicoes.append(definicao)
        return self.salvar(tema)

    def remover_definicao(self, id_: str, termo: str) -> Tema:
        tema = self.ler(id_)
        tema.definicoes = [d for d in tema.definicoes if d.termo.lower() != termo.lower()]
        return self.salvar(tema)

    def renomear(self, id_: str, titulo: str, descricao: str | None = None) -> Tema:
        tema = self.ler(id_)
        if titulo.strip():
            tema.titulo = titulo.strip()
        if descricao is not None:
            tema.descricao = descricao.strip()
        return self.salvar(tema)


# Esquemas que viram link clicável no relatório. `javascript:` e `data:` ficam
# de fora: a URL vem do usuário, e um href com `javascript:` executa no clique.
_ESQUEMAS = ("http", "https")


def _sanear_fonte(bloco: Bloco) -> None:
    """Confere a URL do bloco externo e carimba a data de acesso.

    A data é do SERVIDOR, não do cliente: ela existe para dizer quando o texto
    foi lido, e um valor que o cliente escolhe não serve para isso.
    """
    if bloco.procedencia == "banco":
        bloco.fonte_url = ""
        bloco.fonte_titulo = ""
        bloco.acessado_em = ""
        return

    url = (bloco.fonte_url or "").strip()
    if url:
        partes = urlparse(url)
        if partes.scheme not in _ESQUEMAS or not partes.netloc:
            url = ""
    bloco.fonte_url = url
    # Sem URL não é fonte externa conferível — é anotação de quem investiga.
    if not url and bloco.procedencia == "web":
        bloco.procedencia = "usuario"
    bloco.acessado_em = bloco.acessado_em or date.today().isoformat()


def _agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
