// Lightweight DOM mock for extension unit tests in Node.js
'use strict';

const Node = {
  ELEMENT_NODE: 1,
  ATTRIBUTE_NODE: 2,
  TEXT_NODE: 3,
  DOCUMENT_FRAGMENT_NODE: 11,
};

const NodeFilter = {
  SHOW_ALL: 0xFFFFFFFF,
  SHOW_ELEMENT: 1,
  SHOW_TEXT: 4,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,
};

class DOMTokenList {
  constructor(element) {
    this._el = element;
    this._classes = new Set();
  }
  _syncIndices() {
    const arr = Array.from(this._classes);
    for (let i = 0; i < arr.length; i++) this[i] = arr[i];
    for (let i = arr.length; this[i] !== undefined; i++) delete this[i];
  }
  get length() { return this._classes.size; }
  [Symbol.iterator]() { return this._classes.values(); }
  item(idx) { return Array.from(this._classes)[idx] || null; }
  contains(cls) { return this._classes.has(cls); }
  add(...classes) {
    for (const c of classes) if (c) this._classes.add(c);
    this._syncIndices();
  }
  remove(...classes) {
    for (const c of classes) this._classes.delete(c);
    this._syncIndices();
  }
  toggle(cls, force) {
    if (force !== undefined) {
      if (force) this.add(cls); else this.remove(cls);
      return force;
    }
    if (this.contains(cls)) { this.remove(cls); return false; }
    this.add(cls);
    return true;
  }
  get value() { return Array.from(this._classes).join(' '); }
  set value(val) {
    this._classes.clear();
    if (val) val.trim().split(/\s+/).forEach(c => this._classes.add(c));
    this._syncIndices();
  }
  toArray() { return Array.from(this._classes); }
}

class DOMStyle {
  constructor() {
    this._props = new Map();
  }
  setProperty(prop, val) { this._props.set(prop, val); }
  getPropertyValue(prop) { return this._props.get(prop) || ''; }
  removeProperty(prop) { this._props.delete(prop); }
  get filter() { return this.getPropertyValue('filter'); }
  set filter(val) { this.setProperty('filter', val); }
}

class TestNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.parentElement = null;
  }
}

class TestText extends TestNode {
  constructor(text) {
    super(Node.TEXT_NODE);
    this.textContent = String(text != null ? text : '');
  }
}

class TestFragment extends TestNode {
  constructor() {
    super(Node.DOCUMENT_FRAGMENT_NODE);
    this.childNodes = [];
  }
  appendChild(child) {
    this.childNodes.push(child);
    child.parentNode = this;
    child.parentElement = null;
    return child;
  }
}

class TestElement extends TestNode {
  constructor(tagName, ownerDoc) {
    super(Node.ELEMENT_NODE);
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this.ownerDocument = ownerDoc;
    this.attributes = [];
    this.children = [];
    this.childNodes = [];
    this.classList = new DOMTokenList(this);
    this.style = new DOMStyle();
    this.value = '';
    this._listeners = new Map();
  }

  get className() {
    return this.classList.value;
  }

  set className(val) {
    this.classList.value = String(val || '');
  }

  get innerHTML() {
    return this._rawHTML || this.textContent;
  }

  set innerHTML(val) {
    this._rawHTML = String(val || '');
    parseHTMLInto(this._rawHTML, this, this.ownerDocument);
  }

  addEventListener(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(handler);
  }

  removeEventListener(event, handler) {
    if (this._listeners.has(event)) {
      const handlers = this._listeners.get(event).filter(h => h !== handler);
      this._listeners.set(event, handlers);
    }
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    const handlers = this._listeners.get(type) || [];
    for (const h of handlers) {
      h.call(this, event);
    }
    return true;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  get textContent() {
    let text = '';
    for (const child of this.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
      else if (child.nodeType === Node.ELEMENT_NODE) text += child.textContent;
    }
    return text;
  }

  set textContent(val) {
    this.childNodes = [new TestText(val)];
    this.childNodes[0].parentNode = this;
    this.childNodes[0].parentElement = this;
    this.children = [];
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.classList.value || null;
    const attr = this.attributes.find(a => a.name.toLowerCase() === name.toLowerCase());
    return attr ? attr.value : null;
  }

  setAttribute(name, val) {
    val = String(val);
    if (name === 'id') { this.id = val; }
    if (name === 'class') { this.classList.value = val; }
    const existing = this.attributes.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (existing) { existing.value = val; }
    else { this.attributes.push({ name, value: val }); }
  }

  removeAttribute(name) {
    if (name === 'id') this.id = '';
    if (name === 'class') this.classList.value = '';
    this.attributes = this.attributes.filter(a => a.name.toLowerCase() !== name.toLowerCase());
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  appendChild(child) {
    if (child.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      const items = child.childNodes.slice();
      for (const item of items) this.appendChild(item);
      child.childNodes = [];
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    if (child.nodeType === Node.ELEMENT_NODE) {
      this.children.push(child);
      child.parentElement = this;
    } else {
      child.parentElement = this;
    }
    return child;
  }

  insertBefore(newNode, refNode) {
    if (newNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      const items = newNode.childNodes.slice();
      for (const item of items) this.insertBefore(item, refNode);
      newNode.childNodes = [];
      return newNode;
    }
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    const idx = this.childNodes.indexOf(refNode);
    if (idx === -1) return this.appendChild(newNode);
    this.childNodes.splice(idx, 0, newNode);
    newNode.parentNode = this;
    newNode.parentElement = this;
    this.children = this.childNodes.filter(n => n.nodeType === Node.ELEMENT_NODE);
    return newNode;
  }

  replaceChild(newChild, oldChild) {
    if (newChild.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      const items = newChild.childNodes.slice();
      const idx = this.childNodes.indexOf(oldChild);
      if (idx !== -1) {
        this.childNodes.splice(idx, 1, ...items);
        for (const item of items) {
          item.parentNode = this;
          item.parentElement = this;
        }
        oldChild.parentNode = null;
        oldChild.parentElement = null;
        this.children = this.childNodes.filter(n => n.nodeType === Node.ELEMENT_NODE);
      }
      return oldChild;
    }
    const idx = this.childNodes.indexOf(oldChild);
    if (idx !== -1) {
      if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
      this.childNodes[idx] = newChild;
      newChild.parentNode = this;
      newChild.parentElement = this;
      oldChild.parentNode = null;
      oldChild.parentElement = null;
      this.children = this.childNodes.filter(n => n.nodeType === Node.ELEMENT_NODE);
    }
    return oldChild;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
      child.parentElement = null;
      this.children = this.childNodes.filter(n => n.nodeType === Node.ELEMENT_NODE);
    }
    return child;
  }

  normalize() {
    for (let i = 0; i < this.childNodes.length - 1; i++) {
      if (this.childNodes[i].nodeType === Node.TEXT_NODE && this.childNodes[i + 1].nodeType === Node.TEXT_NODE) {
        this.childNodes[i].textContent += this.childNodes[i + 1].textContent;
        this.removeChild(this.childNodes[i + 1]);
        i--;
      }
    }
    for (const child of this.children) {
      child.normalize();
    }
  }

  closest(selector) {
    let curr = this;
    while (curr && curr.nodeType === Node.ELEMENT_NODE) {
      if (matchesSimple(curr, selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const selectors = selector.split(',').map(s => s.trim());
    const collect = (el) => {
      for (const child of el.children) {
        if (selectors.some(sel => matchesCompound(child, sel, this))) {
          results.push(child);
        }
        collect(child);
      }
    };
    collect(this);
    return results;
  }
}

// Selector matching engine for tests
function matchesSimple(el, sel) {
  sel = sel.trim();
  if (sel === '*') return true;
  // tag:nth-of-type(n)
  const nthMatch = sel.match(/^([a-zA-Z0-9_-]+):nth-of-type\((\d+)\)$/i);
  if (nthMatch) {
    const tag = nthMatch[1].toUpperCase();
    const idx = parseInt(nthMatch[2], 10);
    if (el.tagName !== tag) return false;
    if (!el.parentElement) return idx === 1;
    const sameTagSiblings = el.parentElement.children.filter(c => c.tagName === tag);
    return sameTagSiblings.indexOf(el) + 1 === idx;
  }
  // [attr] or [attr="val"]
  const attrMatch = sel.match(/^\[([a-zA-Z0-9_-]+)(?:=["']?([^"']*)["']?)?\]$/);
  if (attrMatch) {
    const name = attrMatch[1];
    const val = attrMatch[2];
    const actual = el.getAttribute(name);
    if (val === undefined) return actual !== null;
    return actual === val;
  }
  // tag[attr="val"]
  const tagAttrMatch = sel.match(/^([a-zA-Z0-9_-]+)\[([a-zA-Z0-9_-]+)(?:=["']?([^"']*)["']?)?\]$/);
  if (tagAttrMatch) {
    const tag = tagAttrMatch[1].toUpperCase();
    const name = tagAttrMatch[2];
    const val = tagAttrMatch[3];
    if (el.tagName !== tag) return false;
    const actual = el.getAttribute(name);
    if (val === undefined) return actual !== null;
    return actual === val;
  }
  // #id
  if (sel.startsWith('#')) {
    const id = sel.slice(1).replace(/\\/g, '');
    return el.id === id;
  }
  // .class or .class1.class2
  if (sel.startsWith('.')) {
    const classes = sel.split('.').filter(Boolean).map(c => c.replace(/\\/g, ''));
    return classes.every(c => el.classList.contains(c));
  }
  // tag name
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

function matchesCompound(el, fullSelector, root) {
  fullSelector = fullSelector.trim();
  // Support direct child ' > ' combinator
  if (fullSelector.includes(' > ')) {
    const parts = fullSelector.split(' > ').map(s => s.trim());
    let curr = el;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!curr || !matchesSimple(curr, parts[i])) return false;
      curr = curr.parentElement;
    }
    return true;
  }
  return matchesSimple(el, fullSelector);
}

class TestTreeWalker {
  constructor(root, whatToShow, filter) {
    this.root = root;
    this.whatToShow = whatToShow || NodeFilter.SHOW_ALL;
    this.filter = filter || { acceptNode: () => NodeFilter.FILTER_ACCEPT };
    this._nodes = [];
    this._index = -1;
    this._flatten(root);
  }

  _flatten(node) {
    for (const child of node.childNodes) {
      let accept = NodeFilter.FILTER_ACCEPT;
      if (child.nodeType === Node.TEXT_NODE && (this.whatToShow & NodeFilter.SHOW_TEXT)) {
        accept = typeof this.filter === 'function' ? this.filter(child) : this.filter.acceptNode(child);
        if (accept === NodeFilter.FILTER_ACCEPT) this._nodes.push(child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (this.whatToShow & NodeFilter.SHOW_ELEMENT) {
          accept = typeof this.filter === 'function' ? this.filter(child) : this.filter.acceptNode(child);
          if (accept === NodeFilter.FILTER_ACCEPT) this._nodes.push(child);
        }
        if (accept !== NodeFilter.FILTER_REJECT) {
          this._flatten(child);
        }
      }
    }
  }

  nextNode() {
    this._index++;
    if (this._index < this._nodes.length) {
      this.currentNode = this._nodes[this._index];
      return this.currentNode;
    }
    this.currentNode = null;
    return null;
  }
}

function parseAttributes(attrStr, el) {
  if (!attrStr) return;
  const attrRegex = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
  let m;
  while ((m = attrRegex.exec(attrStr)) !== null) {
    const name = m[1];
    const val = m[2] !== undefined ? m[2] : '';
    el.setAttribute(name, val);
  }
}

function parseHTMLInto(html, parentEl, ownerDoc) {
  parentEl.childNodes = [];
  parentEl.children = [];
  if (!html) return;

  const tagRegex = /<([a-zA-Z0-9_-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9_-]+)([^>]*)\/>|<([a-zA-Z0-9_-]+)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match[1]) {
      const tagName = match[1];
      const attrStr = match[2];
      const inner = match[3];
      const el = new TestElement(tagName, ownerDoc);
      parseAttributes(attrStr, el);
      if (inner.includes('<')) {
        parseHTMLInto(inner, el, ownerDoc);
      } else if (inner) {
        el.textContent = inner;
      }
      parentEl.appendChild(el);
    } else if (match[4]) {
      const tagName = match[4];
      const attrStr = match[5];
      const el = new TestElement(tagName, ownerDoc);
      parseAttributes(attrStr, el);
      parentEl.appendChild(el);
    } else if (match[6]) {
      const tagName = match[6];
      const attrStr = match[7];
      const el = new TestElement(tagName, ownerDoc);
      parseAttributes(attrStr, el);
      parentEl.appendChild(el);
    } else if (match[8]) {
      const text = match[8].trim();
      if (text) {
        parentEl.appendChild(new TestText(text));
      }
    }
  }
}

class TestDocument {
  constructor() {
    this.documentElement = new TestElement('html', this);
    this.body = new TestElement('body', this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new TestElement(tagName, this);
  }

  createElementNS(ns, tagName) {
    return new TestElement(tagName, this);
  }

  createTextNode(text) {
    return new TestText(text);
  }

  createDocumentFragment() {
    return new TestFragment();
  }

  createTreeWalker(root, whatToShow, filter) {
    return new TestTreeWalker(root, whatToShow, filter);
  }

  querySelector(sel) {
    return this.documentElement.querySelector(sel);
  }

  querySelectorAll(sel) {
    return this.documentElement.querySelectorAll(sel);
  }
}

function createDOM() {
  const document = new TestDocument();
  return {
    document,
    window: {
      document,
      Node,
      NodeFilter,
      CSS: { escape: (s) => String(s).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1') }
    },
    Node,
    NodeFilter
  };
}

module.exports = {
  createDOM,
  Node,
  NodeFilter,
  TestElement,
  TestText,
  TestDocument
};
