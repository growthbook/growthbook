#!/usr/bin/env bash
# Prints the trimmed "Self-hosted build impact" section of a PR body read from stdin.
perl -0777 -ne '
  s/\r//g;
  s/<!--.*?-->//gs;
  if (/^#{1,6}[ \t]*Self-hosted build impact[ \t]*\n(.*?)(?=^#{1,6}[ \t]|\z)/ims) {
    ($s = $1) =~ s/^\s+|\s+$//g;
    print $s;
  }
'
